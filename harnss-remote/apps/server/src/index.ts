import cookie from "@fastify/cookie";
import staticFiles from "@fastify/static";
import websocket from "@fastify/websocket";
import argon2 from "argon2";
import Database from "better-sqlite3";
import Fastify, { type FastifyRequest } from "fastify";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  DesktopToServerEnvelope,
  RemoteCommandEnvelope,
  RemoteCommandKind,
  RemoteCommandResultEnvelope,
  RemoteSnapshot,
  ServerToDesktopEnvelope,
} from "@harnss-remote/protocol";
import { REMOTE_PROTOCOL_VERSION } from "@harnss-remote/protocol";
import { WebSocket } from "ws";

const PORT = Number(process.env.PORT ?? 3000);
const DATABASE_URL = process.env.DATABASE_URL ?? "file:./data/harnss-remote.sqlite";
const SESSION_COOKIE = "harnss_remote_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STEP_UP_TTL_MS = 5 * 60 * 1000;

type UserSession = { userId: string; expiresAt: number };
type DesktopSocket = { socket: WebSocket; userId: string; desktopId: string };

const sessions = new Map<string, UserSession>();
const desktopSockets = new Map<string, DesktopSocket>();
const clientSockets = new Set<WebSocket>();
const rateBuckets = new Map<string, { startedAt: number; count: number }>();

function sqlitePath(): string {
  if (DATABASE_URL.startsWith("file:")) return DATABASE_URL.slice("file:".length);
  return DATABASE_URL;
}

const dbPath = sqlitePath();
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

function now(): number {
  return Date.now();
}

function id(): string {
  return crypto.randomUUID();
}

function token(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function setupSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      totp_secret_encrypted TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS desktop_devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      last_seen_at INTEGER,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pairing_codes (
      id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      desktop_name TEXT NOT NULL,
      pairing_secret_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS step_up_receipts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      level TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      desktop_id TEXT PRIMARY KEY REFERENCES desktop_devices(id),
      boot_id TEXT NOT NULL,
      stream_id TEXT,
      seq INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      captured_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS remote_events (
      id TEXT PRIMARY KEY,
      desktop_id TEXT NOT NULL REFERENCES desktop_devices(id),
      boot_id TEXT NOT NULL,
      stream_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      retention TEXT NOT NULL,
      event_summary_json TEXT NOT NULL,
      event_json TEXT,
      emitted_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS remote_commands (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      desktop_id TEXT NOT NULL REFERENCES desktop_devices(id),
      idempotency_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_summary_json TEXT NOT NULL,
      status TEXT NOT NULL,
      result_summary_json TEXT,
      error_json TEXT,
      issued_at INTEGER NOT NULL,
      deadline_at INTEGER NOT NULL,
      finished_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_commands_idempotency
      ON remote_commands(user_id, desktop_id, idempotency_key);
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      desktop_id TEXT,
      command_id TEXT,
      action TEXT NOT NULL,
      risk TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL
    );
  `);
}

async function ensureAdminUser(): Promise<void> {
  const count = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  if (count.count > 0) return;
  const email = process.env.REMOTE_ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.REMOTE_ADMIN_PASSWORD ?? "changeme";
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  db.prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(id(), email, passwordHash, now(), now());
  console.warn(`[harnss-remote] Created admin user ${email}. Set REMOTE_ADMIN_PASSWORD in production.`);
}

function audit(input: {
  userId?: string;
  desktopId?: string;
  commandId?: string;
  action: string;
  risk?: string;
  metadata?: unknown;
}): void {
  db.prepare(`
    INSERT INTO audit_logs (id, user_id, desktop_id, command_id, action, risk, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id(), input.userId ?? null, input.desktopId ?? null, input.commandId ?? null, input.action, input.risk ?? null, json(input.metadata), now());
}

function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const bucket = rateBuckets.get(key);
  const current = now();
  if (!bucket || current - bucket.startedAt >= windowMs) {
    rateBuckets.set(key, { startedAt: current, count: 1 });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

function summarizePayload(payload: unknown): unknown {
  const raw = json(payload);
  if (raw.length <= 2000) return payload;
  return { bytes: Buffer.byteLength(raw), preview: raw.slice(0, 1000) };
}

function getSession(request: FastifyRequest): UserSession | null {
  const sessionToken = request.cookies[SESSION_COOKIE];
  if (!sessionToken) return null;
  const session = sessions.get(sessionToken);
  if (!session || session.expiresAt <= now()) {
    sessions.delete(sessionToken);
    return null;
  }
  return session;
}

function requireUser(request: FastifyRequest): string {
  const session = getSession(request);
  if (!session) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  return session.userId;
}

function broadcastClients(value: unknown): void {
  const message = JSON.stringify(value);
  for (const socket of clientSockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
  }
}

function isDesktopOnline(desktopId: string): boolean {
  const desktop = desktopSockets.get(desktopId);
  if (!desktop) return false;
  if (desktop.socket.readyState === WebSocket.OPEN) return true;
  desktopSockets.delete(desktopId);
  return false;
}

function annotateSnapshot(snapshot: RemoteSnapshot, serverLastSeenAt?: number): RemoteSnapshot {
  const online = isDesktopOnline(snapshot.connection.desktopId);
  return {
    ...snapshot,
    connection: {
      ...snapshot.connection,
      online,
      serverStatus: online ? "online" : "offline",
      serverLastSeenAt,
    },
  };
}

function sendDesktop(desktopId: string, envelope: ServerToDesktopEnvelope): boolean {
  const desktop = desktopSockets.get(desktopId);
  if (!desktop || desktop.socket.readyState !== WebSocket.OPEN) {
    if (desktop) desktopSockets.delete(desktopId);
    return false;
  }
  desktop.socket.send(JSON.stringify(envelope));
  return true;
}

function latestSnapshot(userId: string): RemoteSnapshot | null {
  const row = db.prepare(`
    SELECT s.snapshot_json, d.last_seen_at FROM snapshots s
    JOIN desktop_devices d ON d.id = s.desktop_id
    WHERE d.user_id = ? AND d.revoked_at IS NULL
    ORDER BY s.captured_at DESC
    LIMIT 1
  `).get(userId) as { snapshot_json: string; last_seen_at: number | null } | undefined;
  const snapshot = row ? parseJson<RemoteSnapshot | null>(row.snapshot_json, null) : null;
  return snapshot ? annotateSnapshot(snapshot, row?.last_seen_at ?? undefined) : null;
}

function normalizeCommandBody(body: unknown): {
  desktopId: string;
  kind: RemoteCommandKind;
  payload?: unknown;
  idempotencyKey?: string;
  stepUpReceiptId?: string;
} {
  if (!body || typeof body !== "object") throw Object.assign(new Error("Invalid command body"), { statusCode: 400 });
  const record = body as Record<string, unknown>;
  if (typeof record.desktopId !== "string" || typeof record.kind !== "string") {
    throw Object.assign(new Error("desktopId and kind are required"), { statusCode: 400 });
  }
  return {
    desktopId: record.desktopId,
    kind: record.kind as RemoteCommandKind,
    payload: record.payload,
    idempotencyKey: typeof record.idempotencyKey === "string" ? record.idempotencyKey : undefined,
    stepUpReceiptId: typeof record.stepUpReceiptId === "string" ? record.stepUpReceiptId : undefined,
  };
}

function verifyStepUp(userId: string, receiptId: string | undefined): void {
  if (!receiptId) throw Object.assign(new Error("Step-up required"), { statusCode: 403 });
  const row = db.prepare("SELECT id, expires_at FROM step_up_receipts WHERE id = ? AND user_id = ? AND consumed_at IS NULL")
    .get(receiptId, userId) as { id: string; expires_at: number } | undefined;
  if (!row || row.expires_at <= now()) throw Object.assign(new Error("Step-up expired"), { statusCode: 403 });
}

function isHighRisk(kind: RemoteCommandKind): boolean {
  return kind === "permission.respond" ||
    kind === "terminal.write" ||
    kind === "terminal.ctrl_c" ||
    kind === "terminal.lease.request" ||
    kind === "task.start" ||
    kind === "turn.stop";
}

async function main(): Promise<void> {
  setupSchema();
  await ensureAdminUser();

  const fastify = Fastify({ logger: true });
  await fastify.register(cookie);
  await fastify.register(websocket);
  const publicDir = path.resolve("apps/server/public");
  if (fs.existsSync(publicDir)) {
    await fastify.register(staticFiles, {
      root: publicDir,
      prefix: "/",
    });
  }

  fastify.post("/api/auth/login", async (request, reply) => {
    if (!rateLimit(`login:${request.ip}`, 5, 60_000)) {
      return reply.code(429).send({ error: "Too many login attempts" });
    }
    const body = request.body as { email?: string; password?: string };
    const row = db.prepare("SELECT id, email, password_hash FROM users WHERE email = ?")
      .get(body.email ?? "") as { id: string; email: string; password_hash: string } | undefined;
    if (!row || !(await argon2.verify(row.password_hash, body.password ?? ""))) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }
    const sessionToken = token();
    sessions.set(sessionToken, { userId: row.id, expiresAt: now() + SESSION_TTL_MS });
    reply.setCookie(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    });
    return { id: row.id, email: row.email };
  });

  fastify.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  fastify.get("/api/me", async (request, reply) => {
    try {
      const userId = requireUser(request);
      const row = db.prepare("SELECT id, email FROM users WHERE id = ?").get(userId);
      return row;
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  fastify.post("/api/auth/step-up", async (request, reply) => {
    const userId = requireUser(request);
    if (!rateLimit(`step:${userId}`, 5, 60_000)) return reply.code(429).send({ error: "Too many step-up attempts" });
    const body = request.body as { password?: string; level?: "write" | "high_risk" };
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as { password_hash: string };
    if (!(await argon2.verify(row.password_hash, body.password ?? ""))) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }
    const receiptId = id();
    db.prepare("INSERT INTO step_up_receipts (id, user_id, level, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(receiptId, userId, body.level ?? "high_risk", now() + STEP_UP_TTL_MS, now());
    audit({ userId, action: "step_up", risk: body.level ?? "high_risk" });
    return { id: receiptId, expiresAt: now() + STEP_UP_TTL_MS, level: body.level ?? "high_risk" };
  });

  fastify.post("/api/pairing/start", async (request) => {
    const userId = requireUser(request);
    const body = request.body as { desktopName?: string; capabilities?: unknown };
    const deviceId = id();
    const deviceToken = token();
    const desktopName = body.desktopName?.trim() || "Harnss Desktop";
    db.prepare(`
      INSERT INTO desktop_devices (id, user_id, name, token_hash, capabilities_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(deviceId, userId, desktopName, hash(deviceToken), json(body.capabilities ?? {}), now(), now());
    const pairingId = id();
    const code = token(8);
    const secret = token(16);
    db.prepare(`
      INSERT INTO pairing_codes (id, code_hash, desktop_name, pairing_secret_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(pairingId, hash(code), desktopName, hash(secret), now() + 10 * 60 * 1000, now());
    audit({ userId, desktopId: deviceId, action: "pairing.start" });
    return { deviceId, deviceToken, desktopName, pairingId, code, pairingSecret: secret };
  });

  fastify.post("/api/pairing/complete", async (request) => {
    const userId = requireUser(request);
    const body = request.body as { code?: string; pairingSecret?: string };
    const row = db.prepare("SELECT id, desktop_name, expires_at, consumed_at FROM pairing_codes WHERE code_hash = ? AND pairing_secret_hash = ?")
      .get(hash(body.code ?? ""), hash(body.pairingSecret ?? "")) as { id: string; desktop_name: string; expires_at: number; consumed_at: number | null } | undefined;
    if (!row || row.consumed_at || row.expires_at <= now()) {
      throw Object.assign(new Error("Invalid pairing code"), { statusCode: 400 });
    }
    db.prepare("UPDATE pairing_codes SET consumed_at = ? WHERE id = ?").run(now(), row.id);
    const deviceId = id();
    const deviceToken = token();
    db.prepare(`
      INSERT INTO desktop_devices (id, user_id, name, token_hash, capabilities_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(deviceId, userId, row.desktop_name, hash(deviceToken), json({}), now(), now());
    audit({ userId, desktopId: deviceId, action: "pairing.complete" });
    return { deviceId, deviceToken, desktopName: row.desktop_name };
  });

  fastify.get("/api/devices", async (request) => {
    const userId = requireUser(request);
    const rows = db.prepare("SELECT id, name, capabilities_json, last_seen_at, revoked_at, created_at, updated_at FROM desktop_devices WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId) as Array<{ id: string }>;
    return rows.map((row) => ({ ...row, online: isDesktopOnline(row.id) }));
  });

  fastify.post("/api/devices/:deviceId/revoke", async (request) => {
    const userId = requireUser(request);
    const { deviceId } = request.params as { deviceId: string };
    db.prepare("UPDATE desktop_devices SET revoked_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(now(), now(), deviceId, userId);
    sendDesktop(deviceId, { type: "revoked", desktopId: deviceId });
    desktopSockets.get(deviceId)?.socket.close();
    desktopSockets.delete(deviceId);
    audit({ userId, desktopId: deviceId, action: "device.revoke" });
    return { ok: true };
  });

  fastify.get("/api/snapshot", async (request, reply) => {
    const userId = requireUser(request);
    const snapshot = latestSnapshot(userId);
    if (!snapshot) return reply.code(404).send({ error: "No snapshot" });
    return snapshot;
  });

  fastify.get("/api/audit", async (request) => {
    const userId = requireUser(request);
    return db.prepare("SELECT * FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 200").all(userId);
  });

  fastify.post("/api/commands", async (request, reply) => {
    const userId = requireUser(request);
    const body = normalizeCommandBody(request.body);
    if (!rateLimit(`cmd:${userId}:${body.kind}`, isHighRisk(body.kind) ? 5 : 30, 60_000)) {
      return reply.code(429).send({ error: "Command rate limited" });
    }
    if (isHighRisk(body.kind)) verifyStepUp(userId, body.stepUpReceiptId);
    const device = db.prepare("SELECT id FROM desktop_devices WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
      .get(body.desktopId, userId) as { id: string } | undefined;
    if (!device) return reply.code(404).send({ error: "Desktop not found" });

    const commandId = id();
    const issuedAt = now();
    const command: RemoteCommandEnvelope = {
      type: "command",
      protocolVersion: REMOTE_PROTOCOL_VERSION,
      id: commandId,
      desktopId: body.desktopId,
      userId,
      issuedAt,
      deadlineAt: issuedAt + 30_000,
      idempotencyKey: body.idempotencyKey ?? commandId,
      stepUpReceiptId: body.stepUpReceiptId,
      kind: body.kind,
      payload: body.payload,
    };
    db.prepare(`
      INSERT INTO remote_commands (id, user_id, desktop_id, idempotency_key, kind, payload_summary_json, status, issued_at, deadline_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(commandId, userId, body.desktopId, command.idempotencyKey, body.kind, json(summarizePayload(body.payload)), "queued", issuedAt, command.deadlineAt);
    audit({ userId, desktopId: body.desktopId, commandId, action: "command.issued", risk: isHighRisk(body.kind) ? "high" : "low", metadata: { kind: body.kind } });
    if (!sendDesktop(body.desktopId, command)) {
      db.prepare("UPDATE remote_commands SET status = ?, error_json = ?, finished_at = ? WHERE id = ?")
        .run("offline", json({ code: "DESKTOP_OFFLINE", message: "Desktop is offline" }), now(), commandId);
      return reply.code(409).send({ error: "Desktop offline", commandId });
    }
    db.prepare("UPDATE remote_commands SET status = ? WHERE id = ?").run("sent", commandId);
    return { commandId, status: "sent" };
  });

  fastify.get("/api/commands/:commandId", async (request, reply) => {
    const userId = requireUser(request);
    const { commandId } = request.params as { commandId: string };
    const row = db.prepare("SELECT * FROM remote_commands WHERE id = ? AND user_id = ?").get(commandId, userId);
    if (!row) return reply.code(404).send({ error: "Command not found" });
    return row;
  });

  fastify.get("/ws/desktop", { websocket: true }, (socket, request) => {
    const query = request.query as { desktopId?: string; token?: string };
    const desktopId = query.desktopId ?? "";
    const deviceToken = query.token ?? "";
    const device = db.prepare("SELECT id, user_id, token_hash FROM desktop_devices WHERE id = ? AND revoked_at IS NULL")
      .get(desktopId) as { id: string; user_id: string; token_hash: string } | undefined;
    if (!device || hash(deviceToken) !== device.token_hash) {
      socket.close(1008, "Unauthorized");
      return;
    }
    const existing = desktopSockets.get(desktopId);
    if (existing && existing.socket !== socket) existing.socket.close(1000, "Replaced by newer desktop connection");
    desktopSockets.set(desktopId, { socket, userId: device.user_id, desktopId });
    const connectedAt = now();
    db.prepare("UPDATE desktop_devices SET last_seen_at = ?, updated_at = ? WHERE id = ?").run(connectedAt, connectedAt, desktopId);
    audit({ userId: device.user_id, desktopId, action: "desktop.connected" });
    broadcastClients({ type: "desktop_status", desktopId, status: "online", lastSeenAt: connectedAt });

    socket.on("message", (raw) => {
      const envelope = parseJson<DesktopToServerEnvelope | null>(raw.toString(), null);
      if (!envelope || typeof envelope !== "object" || !("type" in envelope)) return;
      if (envelope.type === "heartbeat") {
        db.prepare("UPDATE desktop_devices SET last_seen_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), desktopId);
        return;
      }
      if (envelope.type === "snapshot") {
        const snapshot = envelope.snapshot;
        const capturedAt = now();
        db.prepare(`
          INSERT INTO snapshots (desktop_id, boot_id, stream_id, seq, snapshot_json, captured_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(desktop_id) DO UPDATE SET boot_id = excluded.boot_id, stream_id = excluded.stream_id, seq = excluded.seq, snapshot_json = excluded.snapshot_json, captured_at = excluded.captured_at
        `).run(desktopId, snapshot.cursor.bootId, snapshot.cursor.streamId ?? null, snapshot.cursor.seq, json(snapshot), capturedAt);
        broadcastClients({ type: "snapshot", desktopId, snapshot: annotateSnapshot(snapshot, capturedAt) });
        return;
      }
      if (envelope.type === "event") {
        const persistedEvent = envelope.retention === "persistent" ? json(envelope.event) : null;
        db.prepare(`
          INSERT INTO remote_events (id, desktop_id, boot_id, stream_id, seq, retention, event_summary_json, event_json, emitted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id(), desktopId, envelope.cursor.bootId, envelope.cursor.streamId, envelope.cursor.seq, envelope.retention, json(summarizePayload(envelope.event)), persistedEvent, now());
        broadcastClients({ type: "event", desktopId, event: envelope.event, retention: envelope.retention });
        return;
      }
      if (envelope.type === "command_result") {
        const result = envelope as RemoteCommandResultEnvelope;
        db.prepare(`
          UPDATE remote_commands SET status = ?, result_summary_json = ?, error_json = ?, finished_at = ?
          WHERE id = ? AND desktop_id = ?
        `).run(result.ok ? "succeeded" : "failed", json(summarizePayload(result.result)), json(result.error), result.finishedAt, result.commandId, desktopId);
        audit({ userId: device.user_id, desktopId, commandId: result.commandId, action: "command.result", risk: result.ok ? "low" : "medium", metadata: result.error ?? result.result });
        broadcastClients({ type: "command_result", desktopId, result });
      }
    });

    socket.on("close", () => {
      const wasCurrentSocket = desktopSockets.get(desktopId)?.socket === socket;
      if (wasCurrentSocket) desktopSockets.delete(desktopId);
      audit({ userId: device.user_id, desktopId, action: "desktop.disconnected" });
      if (wasCurrentSocket) broadcastClients({ type: "desktop_status", desktopId, status: "offline", lastSeenAt: now() });
    });
  });

  fastify.get("/ws/client", { websocket: true }, (socket, request) => {
    const session = getSession(request);
    if (!session) {
      socket.close(1008, "Unauthorized");
      return;
    }
    clientSockets.add(socket);
    const snapshot = latestSnapshot(session.userId);
    if (snapshot) socket.send(JSON.stringify({ type: "snapshot", desktopId: snapshot.connection.desktopId, snapshot }));
    socket.on("close", () => clientSockets.delete(socket));
  });

  await fastify.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
