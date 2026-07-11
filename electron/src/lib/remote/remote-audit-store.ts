import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";
import { getDataDir } from "../data-dir";
import type { RemoteCommandError, RemoteCommandKind } from "@shared/types/remote";

export type RemoteAuditAction =
  | "command.issued"
  | "command.accepted"
  | "command.rejected"
  | "permission.respond"
  | "terminal.write"
  | "task.start"
  | "chat.send"
  | "capability.changed"
  | "pairing"
  | "revoke"
  | "connector.connected"
  | "connector.disconnected";

export interface RemoteAuditEntry {
  id: string;
  createdAt: number;
  action: RemoteAuditAction;
  desktopId?: string;
  commandId?: string;
  userId?: string;
  kind?: RemoteCommandKind;
  risk?: "low" | "medium" | "high";
  metadata?: Record<string, unknown>;
  error?: RemoteCommandError;
}

function auditFilePath(): string {
  return path.join(getDataDir(), "remote-audit.jsonl");
}

function summarizeString(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

export function redactRemoteAuditMetadata(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return summarizeString(value, 160);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactRemoteAuditMetadata(item));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (lower.includes("token") || lower.includes("secret") || lower.includes("password")) {
      redacted[key] = "[redacted]";
      continue;
    }
    if (lower === "diff" || lower === "output" || lower === "rawpreview") {
      redacted[key] = typeof entry === "string"
        ? { length: entry.length, preview: summarizeString(entry, 120) }
        : "[redacted]";
      continue;
    }
    if (lower === "data" && typeof entry === "string") {
      redacted[key] = { length: entry.length, preview: summarizeString(entry, 40) };
      continue;
    }
    redacted[key] = redactRemoteAuditMetadata(entry);
  }
  return redacted;
}

export class RemoteAuditStore {
  async append(entry: Omit<RemoteAuditEntry, "id" | "createdAt">): Promise<RemoteAuditEntry> {
    const next: RemoteAuditEntry = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      ...entry,
      metadata: entry.metadata
        ? redactRemoteAuditMetadata(entry.metadata) as Record<string, unknown>
        : undefined,
    };
    const line = `${JSON.stringify(next)}\n`;
    await fs.mkdir(path.dirname(auditFilePath()), { recursive: true });
    await fs.appendFile(auditFilePath(), line, { encoding: "utf-8", mode: 0o600 });
    return next;
  }

  async list(limit = 200): Promise<RemoteAuditEntry[]> {
    try {
      const raw = await fs.readFile(auditFilePath(), "utf-8");
      return raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .slice(-Math.max(1, Math.min(limit, 1000)))
        .map((line) => JSON.parse(line) as RemoteAuditEntry);
    } catch {
      return [];
    }
  }
}
