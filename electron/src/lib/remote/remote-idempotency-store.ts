import path from "path";
import { promises as fs } from "fs";
import { getDataDir } from "../data-dir";
import { atomicWriteFile } from "../atomic-write";
import type {
  RemoteCommandKind,
  RemoteCommandResultEnvelope,
  RemoteWriteCommandKind,
} from "@shared/types/remote";

export interface DesktopIdempotencyKey {
  desktopId: string;
  commandId: string;
  idempotencyKey: string;
  kind: RemoteCommandKind;
}

interface StoredIdempotencyEntry {
  key: DesktopIdempotencyKey;
  result: RemoteCommandResultEnvelope;
  createdAt: number;
  expiresAt: number;
}

interface StoredIdempotencyFile {
  version: 1;
  entries: StoredIdempotencyEntry[];
}

const WRITE_RETENTION_MS = 24 * 60 * 60 * 1000;
const READ_RETENTION_MS = 5 * 60 * 1000;

const WRITE_COMMANDS = new Set<RemoteCommandKind>([
  "chat.send",
  "task.start",
  "turn.interrupt",
  "turn.stop",
  "permission.respond",
  "terminal.lease.request",
  "terminal.lease.revoke",
  "terminal.write",
  "terminal.ctrl_c",
] satisfies RemoteWriteCommandKind[]);

function storePath(): string {
  return path.join(getDataDir(), "remote-idempotency.json");
}

function makeKey(key: DesktopIdempotencyKey): string {
  return [
    key.desktopId,
    key.kind,
    key.idempotencyKey,
    key.commandId,
  ].join(":");
}

export class RemoteIdempotencyStore {
  private entries = new Map<string, StoredIdempotencyEntry>();
  private loaded = false;

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(storePath(), "utf-8");
      const parsed = JSON.parse(raw) as Partial<StoredIdempotencyFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return;
      const now = Date.now();
      for (const entry of parsed.entries) {
        if (!entry || entry.expiresAt <= now) continue;
        this.entries.set(makeKey(entry.key), entry);
      }
    } catch {
      // Missing or invalid cache is non-fatal.
    }
  }

  private async persist(): Promise<void> {
    const now = Date.now();
    const entries = [...this.entries.values()].filter((entry) => entry.expiresAt > now);
    this.entries = new Map(entries.map((entry) => [makeKey(entry.key), entry]));
    const file: StoredIdempotencyFile = { version: 1, entries };
    await atomicWriteFile(storePath(), JSON.stringify(file, null, 2), 0o600);
  }

  async get(key: DesktopIdempotencyKey): Promise<RemoteCommandResultEnvelope | null> {
    await this.load();
    const entry = this.entries.get(makeKey(key));
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(makeKey(key));
      await this.persist();
      return null;
    }
    return entry.result;
  }

  async set(key: DesktopIdempotencyKey, result: RemoteCommandResultEnvelope): Promise<void> {
    await this.load();
    const now = Date.now();
    const retentionMs = WRITE_COMMANDS.has(key.kind) ? WRITE_RETENTION_MS : READ_RETENTION_MS;
    this.entries.set(makeKey(key), {
      key,
      result,
      createdAt: now,
      expiresAt: now + retentionMs,
    });
    await this.persist();
  }

  async clearExpired(): Promise<void> {
    await this.load();
    await this.persist();
  }
}
