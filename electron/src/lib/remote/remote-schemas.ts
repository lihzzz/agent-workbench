import {
  REMOTE_PROTOCOL_VERSION,
  type RemoteCapability,
  type RemoteChatSendPayload,
  type RemoteCommandEnvelope,
  type RemoteCommandKind,
  type RemoteDiffFilePayload,
  type RemoteMessagesListPayload,
  type RemotePathRef,
  type RemotePermissionRespondPayload,
  type RemoteSessionCommandPayload,
  type RemoteStartTaskPayload,
  type RemoteTerminalLeaseRequestPayload,
  type RemoteTerminalLeaseRevokePayload,
  type RemoteTerminalPayload,
  type RemoteTerminalSubscribePayload,
  type RemoteTerminalWritePayload,
} from "@shared/types/remote";
import type { EngineId } from "@shared/types/engine";

const READ_COMMANDS = new Set<RemoteCommandKind>([
  "snapshot.request",
  "sessions.list",
  "messages.list",
  "diff.summary",
  "diff.file",
  "terminal.list",
  "terminal.snapshot",
  "terminal.subscribe",
  "terminal.unsubscribe",
]);

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
]);

export const REMOTE_COMMAND_KINDS = new Set<RemoteCommandKind>([
  ...READ_COMMANDS,
  ...WRITE_COMMANDS,
]);

const ENGINE_IDS = new Set<EngineId>(["claude", "codex", "acp", "opencode"]);
const PROFILE_IDS = new Set(["read_only", "workspace_write_approval", "workspace_write_auto_read"]);

export const MAX_REMOTE_PAYLOAD_BYTES = 128 * 1024;

export function isRemoteWriteCommand(kind: RemoteCommandKind): boolean {
  return WRITE_COMMANDS.has(kind);
}

export function isRemoteReadCommand(kind: RemoteCommandKind): boolean {
  return READ_COMMANDS.has(kind);
}

export function remoteCapabilityForCommand(kind: RemoteCommandKind): RemoteCapability {
  switch (kind) {
    case "snapshot.request":
    case "sessions.list":
      return "status.read";
    case "messages.list":
      return "chat.read";
    case "chat.send":
      return "chat.write";
    case "task.start":
      return "task.start";
    case "turn.interrupt":
    case "turn.stop":
      return "task.stop";
    case "permission.respond":
      return "permission.respond";
    case "diff.summary":
    case "diff.file":
      return "diff.read";
    case "terminal.list":
    case "terminal.snapshot":
    case "terminal.subscribe":
    case "terminal.unsubscribe":
      return "terminal.read";
    case "terminal.lease.request":
    case "terminal.lease.revoke":
      return "terminal.write";
    case "terminal.write":
    case "terminal.ctrl_c":
      return "terminal.write";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string, maxLength = 4096): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function optionalStringField(record: Record<string, unknown>, key: string, maxLength = 4096): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`${key} must be a string`);
  }
  return value;
}

function optionalBooleanField(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
  return value;
}

function optionalNumberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }
  return value;
}

function optionalStringArrayRecordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, string[]> | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${key} must be an object`);

  const parsed: Record<string, string[]> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey.length === 0 || entryKey.length > 256) {
      throw new Error(`${key} keys must be non-empty strings under 256 characters`);
    }
    if (!Array.isArray(entryValue) || entryValue.length > 20) {
      throw new Error(`${key}.${entryKey} must be an array with at most 20 values`);
    }
    parsed[entryKey] = entryValue.map((item) => {
      if (typeof item !== "string" || item.length > 4096) {
        throw new Error(`${key}.${entryKey} values must be strings under 4096 characters`);
      }
      return item;
    });
  }
  return parsed;
}

function assertSafeRelativeRef(value: string | undefined, key: string): void {
  if (!value) return;
  if (value.startsWith("/") || value.startsWith("\\") || value.includes("..")) {
    throw new Error(`${key} must be a safe relative ref`);
  }
}

function payloadSizeBytes(payload: unknown): number {
  return Buffer.byteLength(JSON.stringify(payload ?? null), "utf-8");
}

function parsePathRef(value: unknown): RemotePathRef {
  if (!isRecord(value)) throw new Error("path must be an object");
  return {
    projectId: stringField(value, "projectId", 256),
    repoId: optionalStringField(value, "repoId", 1024),
    worktreeId: optionalStringField(value, "worktreeId", 1024),
    relativePath: optionalStringField(value, "relativePath", 4096),
  };
}

function parseNoPayload(payload: unknown): undefined {
  if (payload !== undefined && payload !== null) {
    if (isRecord(payload) && Object.keys(payload).length === 0) return undefined;
    throw new Error("payload must be empty");
  }
  return undefined;
}

function parseSessionCommand(payload: unknown): RemoteSessionCommandPayload {
  if (!isRecord(payload)) throw new Error("payload must be an object");
  return { sessionId: stringField(payload, "sessionId", 256) };
}

function parseTerminalCommand(payload: unknown): RemoteTerminalPayload {
  if (!isRecord(payload)) throw new Error("payload must be an object");
  return { terminalId: stringField(payload, "terminalId", 256) };
}

export function parseRemoteCommandEnvelope(value: unknown): RemoteCommandEnvelope {
  if (!isRecord(value)) throw new Error("Remote command envelope must be an object");
  if (value.type !== "command") throw new Error("Envelope type must be command");
  if (value.protocolVersion !== REMOTE_PROTOCOL_VERSION) throw new Error("Unsupported protocol version");

  const kind = value.kind;
  if (typeof kind !== "string" || !REMOTE_COMMAND_KINDS.has(kind as RemoteCommandKind)) {
    throw new Error("Unsupported command kind");
  }

  const issuedAt = value.issuedAt;
  const deadlineAt = value.deadlineAt;
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) {
    throw new Error("issuedAt must be a finite number");
  }
  if (typeof deadlineAt !== "number" || !Number.isFinite(deadlineAt)) {
    throw new Error("deadlineAt must be a finite number");
  }

  return {
    type: "command",
    protocolVersion: REMOTE_PROTOCOL_VERSION,
    id: stringField(value, "id", 256),
    desktopId: stringField(value, "desktopId", 256),
    userId: stringField(value, "userId", 256),
    issuedAt,
    deadlineAt,
    idempotencyKey: stringField(value, "idempotencyKey", 256),
    stepUpReceiptId: optionalStringField(value, "stepUpReceiptId", 256),
    kind: kind as RemoteCommandKind,
    payload: value.payload,
  };
}

export function parseRemotePayload(kind: RemoteCommandKind, payload: unknown): unknown {
  const size = payloadSizeBytes(payload);
  if (size > MAX_REMOTE_PAYLOAD_BYTES) {
    throw new Error("payload exceeds byte limit");
  }

  switch (kind) {
    case "snapshot.request":
    case "sessions.list":
      return parseNoPayload(payload);
    case "messages.list": {
      if (!isRecord(payload)) throw new Error("payload must be an object");
      const parsed: RemoteMessagesListPayload = {
        sessionId: stringField(payload, "sessionId", 256),
        cursor: optionalStringField(payload, "cursor", 256),
        limit: optionalNumberField(payload, "limit"),
      };
      return parsed;
    }
    case "diff.summary": {
      if (!isRecord(payload)) throw new Error("payload must be an object");
      return { path: parsePathRef(payload.path) };
    }
    case "diff.file": {
      if (!isRecord(payload)) throw new Error("payload must be an object");
      const parsed: RemoteDiffFilePayload = {
        path: parsePathRef(payload.path),
        staged: optionalBooleanField(payload, "staged"),
      };
      return parsed;
    }
    case "terminal.list":
      return parseNoPayload(payload);
    case "terminal.snapshot":
      return parseTerminalCommand(payload);
    case "terminal.subscribe":
    case "terminal.unsubscribe": {
      const terminal = parseTerminalCommand(payload);
      return terminal satisfies RemoteTerminalSubscribePayload;
    }
    case "chat.send": {
      if (!isRecord(payload)) throw new Error("payload must be an object");
      const parsed: RemoteChatSendPayload = {
        sessionId: stringField(payload, "sessionId", 256),
        text: stringField(payload, "text", 64 * 1024),
      };
      return parsed;
    }
    case "task.start": {
      if (!isRecord(payload)) throw new Error("payload must be an object");
      const engine = stringField(payload, "engine", 32);
      const profileId = stringField(payload, "profileId", 64);
      if (!ENGINE_IDS.has(engine as EngineId)) throw new Error("engine is not supported");
      if (!PROFILE_IDS.has(profileId)) throw new Error("profileId is not supported");
      const parsed: RemoteStartTaskPayload = {
        projectId: stringField(payload, "projectId", 256),
        worktreeId: optionalStringField(payload, "worktreeId", 1024),
        engine: engine as EngineId,
        profileId: profileId as RemoteStartTaskPayload["profileId"],
        model: optionalStringField(payload, "model", 256),
        prompt: stringField(payload, "prompt", 64 * 1024),
      };
      assertSafeRelativeRef(parsed.worktreeId, "worktreeId");
      return parsed;
    }
    case "turn.interrupt":
    case "turn.stop":
      return parseSessionCommand(payload);
    case "permission.respond": {
      if (!isRecord(payload)) throw new Error("payload must be an object");
      const rawAction = payload.action;
      if (!isRecord(rawAction)) throw new Error("action must be an object");
      const kindValue = rawAction.kind;
      if (kindValue !== "approve_once" && kindValue !== "deny" && kindValue !== "answer") {
        throw new Error("action.kind is not supported");
      }
      const action = {
        kind: kindValue,
        label: stringField(rawAction, "label", 256),
        ...(kindValue === "answer"
          ? {
              optionId: stringField(rawAction, "optionId", 256),
              answers: optionalStringArrayRecordField(rawAction, "answers"),
            }
          : {}),
      } as RemotePermissionRespondPayload["action"];
      const parsed: RemotePermissionRespondPayload = {
        sessionId: stringField(payload, "sessionId", 256),
        requestId: stringField(payload, "requestId", 256),
        action,
      };
      return parsed;
    }
    case "terminal.lease.request": {
      if (!isRecord(payload)) throw new Error("payload must be an object");
      const parsed: RemoteTerminalLeaseRequestPayload = {
        terminalId: stringField(payload, "terminalId", 256),
        ttlMs: optionalNumberField(payload, "ttlMs"),
      };
      return parsed;
    }
    case "terminal.lease.revoke": {
      if (!isRecord(payload)) throw new Error("payload must be an object");
      const parsed: RemoteTerminalLeaseRevokePayload = {
        leaseId: stringField(payload, "leaseId", 256),
      };
      return parsed;
    }
    case "terminal.write": {
      if (!isRecord(payload)) throw new Error("payload must be an object");
      const parsed: RemoteTerminalWritePayload = {
        terminalId: stringField(payload, "terminalId", 256),
        leaseId: stringField(payload, "leaseId", 256),
        data: stringField(payload, "data", 4096),
      };
      return parsed;
    }
    case "terminal.ctrl_c": {
      if (!isRecord(payload)) throw new Error("payload must be an object");
      const parsed: Pick<RemoteTerminalWritePayload, "terminalId" | "leaseId"> = {
        terminalId: stringField(payload, "terminalId", 256),
        leaseId: stringField(payload, "leaseId", 256),
      };
      return parsed;
    }
  }
}
