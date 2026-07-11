export const REMOTE_PROTOCOL_VERSION = 1;

export type RemoteConnectorStatus = "disabled" | "pairing" | "connecting" | "connected" | "backoff" | "revoked";

export type RemoteCapability =
  | "status.read"
  | "chat.read"
  | "chat.write"
  | "task.start"
  | "task.stop"
  | "permission.respond"
  | "diff.read"
  | "terminal.read"
  | "terminal.write";

export type RemoteCommandKind =
  | "snapshot.request"
  | "sessions.list"
  | "messages.list"
  | "diff.summary"
  | "diff.file"
  | "terminal.list"
  | "terminal.snapshot"
  | "terminal.subscribe"
  | "terminal.unsubscribe"
  | "chat.send"
  | "task.start"
  | "turn.interrupt"
  | "turn.stop"
  | "permission.respond"
  | "terminal.lease.request"
  | "terminal.lease.revoke"
  | "terminal.write"
  | "terminal.ctrl_c";

export type RemoteEventRetention = "persistent" | "snapshot_only" | "transient";

export type RemotePermissionAction =
  | { kind: "approve_once"; label: string }
  | { kind: "deny"; label: string }
  | {
      kind: "answer";
      optionId: string;
      label: string;
      answers?: Record<string, string[]>;
    };

export interface StreamCursor {
  bootId: string;
  streamId: string;
  seq: number;
}

export interface RemoteCommandEnvelope {
  type: "command";
  protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
  id: string;
  desktopId: string;
  userId: string;
  issuedAt: number;
  deadlineAt: number;
  idempotencyKey: string;
  stepUpReceiptId?: string;
  kind: RemoteCommandKind;
  payload?: unknown;
}

export interface RemoteCommandError {
  code: string;
  message: string;
}

export interface RemoteCommandResultEnvelope {
  type: "command_result";
  protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
  desktopId: string;
  commandId: string;
  kind: RemoteCommandKind;
  ok: boolean;
  result?: unknown;
  error?: RemoteCommandError;
  finishedAt: number;
}

export interface RemotePermissionRequest {
  requestId: string;
  sessionId: string;
  engine: "claude" | "codex" | "acp" | "opencode";
  createdAt: number;
  expiresAt: number;
  toolName: string;
  cwd?: string;
  risk: "low" | "medium" | "high";
  summary: string;
  rawPreview: string;
  allowedActions: RemotePermissionAction[];
}

export interface RemoteEventEnvelope {
  type: "event";
  protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
  desktopId: string;
  cursor: StreamCursor;
  retention: RemoteEventRetention;
  event: unknown;
}

export interface RemoteSnapshot {
  app: {
    version: string;
    platform: "darwin" | "win32" | "linux";
    remoteEnabled: boolean;
    degraded?: boolean;
  };
  connection: {
    desktopId: string;
    bootId: string;
    streamId?: string;
    connectedAt?: number;
    lastHeartbeatAt?: number;
    rendererReady: boolean;
    online?: boolean;
    serverStatus?: "online" | "offline";
    serverLastSeenAt?: number;
  };
  projects: Array<{ id: string; name: string; path?: string; spaceId?: string }>;
  spaces: Array<{ id: string; name: string; icon?: string; iconType?: string }>;
  sessions: Array<{
    id: string;
    projectId: string;
    title: string;
    engine: "claude" | "codex" | "acp" | "opencode";
    model?: string;
    lastMessageAt?: number;
    createdAt: number;
    isActive: boolean;
    isProcessing: boolean;
    hasPendingPermission: boolean;
    messageCount?: number;
  }>;
  activeSessionId?: string;
  selectedRemoteSessionId?: string;
  pendingPermissions: RemotePermissionRequest[];
  git?: unknown;
  terminals: unknown[];
  cursor: StreamCursor;
}

export type DesktopToServerEnvelope =
  | { type: "hello"; protocolVersion: typeof REMOTE_PROTOCOL_VERSION; desktopId: string; desktopName: string; appVersion: string; capabilities: Record<RemoteCapability, boolean>; bootId: string }
  | { type: "heartbeat"; protocolVersion: typeof REMOTE_PROTOCOL_VERSION; desktopId: string; bootId: string; streamId: string; sentAt: number; rendererReady: boolean }
  | { type: "snapshot"; protocolVersion: typeof REMOTE_PROTOCOL_VERSION; desktopId: string; snapshot: RemoteSnapshot }
  | RemoteEventEnvelope
  | RemoteCommandResultEnvelope;

export type ServerToDesktopEnvelope =
  | RemoteCommandEnvelope
  | { type: "ack"; protocolVersion: typeof REMOTE_PROTOCOL_VERSION; desktopId: string; cursor?: StreamCursor }
  | { type: "revoked"; desktopId: string };
