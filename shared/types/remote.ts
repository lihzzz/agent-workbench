import type { EngineId } from "./engine";

export const REMOTE_PROTOCOL_VERSION = 1;

export type RemoteConnectorStatus =
  | "disabled"
  | "pairing"
  | "connecting"
  | "connected"
  | "backoff"
  | "revoked";

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

export type RemoteTerminalWriteMode = "disabled" | "temporary";

export interface RemoteControlPublicSettings {
  enabled: boolean;
  serverUrl?: string;
  desktopName?: string;
  capabilities: Record<RemoteCapability, boolean>;
  terminalWriteMode: RemoteTerminalWriteMode;
  terminalWriteTtlMs: number;
}

export type RemoteExecutionProfileId =
  | "read_only"
  | "workspace_write_approval"
  | "workspace_write_auto_read";

export interface RemoteExecutionProfile {
  id: RemoteExecutionProfileId;
  label: string;
  engines: EngineId[];
  allowShell: boolean;
  allowNetwork: boolean;
  allowWorkspaceWrite: boolean;
  allowDangerFullAccess: false;
  allowBypassPermissions: false;
  allowPersistentToolApproval: false;
}

export const DEFAULT_REMOTE_CAPABILITIES: Record<RemoteCapability, boolean> = {
  "status.read": true,
  "chat.read": true,
  "chat.write": false,
  "task.start": false,
  "task.stop": false,
  "permission.respond": false,
  "diff.read": true,
  "terminal.read": true,
  "terminal.write": false,
};

export const DEFAULT_REMOTE_CONTROL_SETTINGS: RemoteControlPublicSettings = {
  enabled: false,
  capabilities: DEFAULT_REMOTE_CAPABILITIES,
  terminalWriteMode: "disabled",
  terminalWriteTtlMs: 10 * 60 * 1000,
};

export const REMOTE_EXECUTION_PROFILES: RemoteExecutionProfile[] = [
  {
    id: "read_only",
    label: "Read Only",
    engines: ["claude", "codex", "acp", "opencode"],
    allowShell: false,
    allowNetwork: false,
    allowWorkspaceWrite: false,
    allowDangerFullAccess: false,
    allowBypassPermissions: false,
    allowPersistentToolApproval: false,
  },
  {
    id: "workspace_write_approval",
    label: "Workspace Write With Approval",
    engines: ["claude", "codex", "acp", "opencode"],
    allowShell: false,
    allowNetwork: false,
    allowWorkspaceWrite: true,
    allowDangerFullAccess: false,
    allowBypassPermissions: false,
    allowPersistentToolApproval: false,
  },
  {
    id: "workspace_write_auto_read",
    label: "Workspace Write Auto Read",
    engines: ["claude", "codex", "acp", "opencode"],
    allowShell: false,
    allowNetwork: false,
    allowWorkspaceWrite: true,
    allowDangerFullAccess: false,
    allowBypassPermissions: false,
    allowPersistentToolApproval: false,
  },
];

export type RemoteReadCommandKind =
  | "snapshot.request"
  | "sessions.list"
  | "messages.list"
  | "diff.summary"
  | "diff.file"
  | "terminal.list"
  | "terminal.snapshot"
  | "terminal.subscribe"
  | "terminal.unsubscribe";

export type RemoteWriteCommandKind =
  | "chat.send"
  | "task.start"
  | "turn.interrupt"
  | "turn.stop"
  | "permission.respond"
  | "terminal.lease.request"
  | "terminal.lease.revoke"
  | "terminal.write"
  | "terminal.ctrl_c";

export type RemoteCommandKind = RemoteReadCommandKind | RemoteWriteCommandKind;

export type RemoteEventRetention = "persistent" | "snapshot_only" | "transient";

export interface StreamCursor {
  bootId: string;
  streamId: string;
  seq: number;
}

export interface RemotePathRef {
  projectId: string;
  repoId?: string;
  worktreeId?: string;
  relativePath?: string;
}

export interface RemoteStartTaskPayload {
  projectId: string;
  worktreeId?: string;
  engine: EngineId;
  profileId: RemoteExecutionProfileId;
  model?: string;
  prompt: string;
}

export interface RemoteChatSendPayload {
  sessionId: string;
  text: string;
}

export type RemotePermissionAction =
  | { kind: "approve_once"; label: string }
  | { kind: "deny"; label: string }
  | {
      kind: "answer";
      optionId: string;
      label: string;
      answers?: Record<string, string[]>;
    };

export interface RemotePermissionRespondPayload {
  sessionId: string;
  requestId: string;
  action: RemotePermissionAction;
}

export interface RemoteDiffFilePayload {
  path: RemotePathRef;
  staged?: boolean;
}

export interface RemoteMessagesListPayload {
  sessionId: string;
  cursor?: string;
  limit?: number;
}

export interface RemoteSessionCommandPayload {
  sessionId: string;
}

export interface RemoteTerminalPayload {
  terminalId: string;
}

export interface RemoteTerminalWritePayload {
  terminalId: string;
  leaseId: string;
  data: string;
}

export interface RemoteTerminalLeaseRequestPayload {
  terminalId: string;
  ttlMs?: number;
}

export interface RemoteTerminalLeaseRevokePayload {
  leaseId: string;
}

export interface RemoteTerminalSubscribePayload {
  terminalId: string;
}

export type RemoteCommandPayload =
  | undefined
  | RemoteStartTaskPayload
  | RemoteChatSendPayload
  | RemotePermissionRespondPayload
  | RemoteDiffFilePayload
  | RemoteMessagesListPayload
  | RemoteSessionCommandPayload
  | RemoteTerminalPayload
  | RemoteTerminalWritePayload
  | RemoteTerminalLeaseRequestPayload
  | RemoteTerminalLeaseRevokePayload
  | RemoteTerminalSubscribePayload;

export interface RemoteHelloEnvelope {
  type: "hello";
  protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
  desktopId: string;
  desktopName: string;
  appVersion: string;
  capabilities: Record<RemoteCapability, boolean>;
  bootId: string;
}

export interface RemoteHeartbeatEnvelope {
  type: "heartbeat";
  protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
  desktopId: string;
  bootId: string;
  streamId: string;
  sentAt: number;
  rendererReady: boolean;
}

export interface RemoteSnapshotEnvelope {
  type: "snapshot";
  protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
  desktopId: string;
  snapshot: RemoteSnapshot;
}

export interface RemoteEventEnvelope {
  type: "event";
  protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
  desktopId: string;
  cursor: StreamCursor;
  retention: RemoteEventRetention;
  event: RemoteEvent;
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

export interface RemoteAckEnvelope {
  type: "ack";
  protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
  desktopId: string;
  cursor: StreamCursor;
}

export type RemoteEnvelope =
  | RemoteHelloEnvelope
  | RemoteHeartbeatEnvelope
  | RemoteSnapshotEnvelope
  | RemoteEventEnvelope
  | RemoteCommandEnvelope
  | RemoteCommandResultEnvelope
  | RemoteAckEnvelope;

export type RemoteCommandErrorCode =
  | "INVALID_ENVELOPE"
  | "UNSUPPORTED_COMMAND"
  | "PAYLOAD_TOO_LARGE"
  | "DESKTOP_MISMATCH"
  | "COMMAND_EXPIRED"
  | "REMOTE_DISABLED"
  | "RENDERER_UNAVAILABLE"
  | "CAPABILITY_DENIED"
  | "RATE_LIMITED"
  | "STEP_UP_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "PATH_NOT_ALLOWED"
  | "SESSION_NOT_FOUND"
  | "SESSION_BUSY"
  | "PERMISSION_NOT_FOUND"
  | "PERMISSION_ALREADY_RESOLVED"
  | "TERMINAL_NOT_FOUND"
  | "TERMINAL_LEASE_REQUIRED"
  | "TERMINAL_LEASE_EXPIRED"
  | "TERMINAL_WRITE_TOO_LARGE"
  | "INTERNAL_ERROR";

export interface RemoteCommandError {
  code: RemoteCommandErrorCode;
  message: string;
}

export interface RemoteProject {
  id: string;
  name: string;
  path?: string;
  spaceId?: string;
}

export interface RemoteSpace {
  id: string;
  name: string;
  icon?: string;
  iconType?: string;
  projectId?: string;
  worktreePath?: string;
}

export interface RemoteSessionSummary {
  id: string;
  projectId: string;
  title: string;
  engine: EngineId;
  model?: string;
  lastMessageAt?: number;
  createdAt: number;
  isActive: boolean;
  isProcessing: boolean;
  hasPendingPermission: boolean;
  messageCount?: number;
}

export interface RemoteMessage {
  id: string;
  role: "user" | "assistant" | "tool_call" | "tool_result" | "system" | "summary";
  content: string;
  timestamp: number;
  toolName?: string;
  isStreaming?: boolean;
  isError?: boolean;
}

export interface RemoteMessagePage {
  messages: RemoteMessage[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface RemoteChatInput {
  text: string;
}

export interface RemoteStartTaskInput extends RemoteStartTaskPayload {}

export interface RemoteSessionSnapshot {
  session: RemoteSessionSummary;
  messages: RemoteMessage[];
  pendingPermission?: RemotePermissionRequest;
}

export interface RemotePermissionRequest {
  requestId: string;
  sessionId: string;
  engine: EngineId;
  createdAt: number;
  expiresAt: number;
  toolName: string;
  cwd?: string;
  risk: "low" | "medium" | "high";
  summary: string;
  rawPreview: string;
  allowedActions: RemotePermissionAction[];
}

export interface RemoteGitFileChange {
  path: string;
  oldPath?: string;
  status: string;
  group: string;
}

export interface RemoteGitSummary {
  branch?: string;
  ahead?: number;
  behind?: number;
  files: RemoteGitFileChange[];
  additions?: number;
  deletions?: number;
}

export interface RemoteTerminalSummary {
  terminalId: string;
  spaceId: string;
  createdAt: number;
  lastActivityAt: number;
  exited: boolean;
  exitCode: number | null;
  cwd?: string;
}

export interface RemoteTerminalSnapshot {
  terminalId: string;
  output: string;
  seq: number;
  cols: number;
  rows: number;
  exited: boolean;
  exitCode: number | null;
  truncated: boolean;
}

export interface RemoteDiffSummary {
  branch?: string;
  files: RemoteGitFileChange[];
  additions: number;
  deletions: number;
}

export interface RemoteDiffFileResult {
  path: string;
  diff: string;
  staged: boolean;
  binary: boolean;
  truncated: boolean;
  sizeBytes: number;
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
  projects: RemoteProject[];
  spaces: RemoteSpace[];
  sessions: RemoteSessionSummary[];
  activeSessionId?: string;
  selectedRemoteSessionId?: string;
  pendingPermissions: RemotePermissionRequest[];
  git?: RemoteGitSummary;
  terminals: RemoteTerminalSummary[];
  cursor: StreamCursor;
}

export type RemoteEvent =
  | { type: "connector.status"; status: RemoteConnectorStatus; at: number }
  | { type: "session.updated"; sessionId: string; at: number }
  | { type: "permission.requested"; request: RemotePermissionRequest; at: number }
  | { type: "terminal.data"; terminalId: string; data: string; seq: number; at: number }
  | { type: "command.accepted"; commandId: string; kind: RemoteCommandKind; at: number }
  | { type: "command.rejected"; commandId: string; kind: RemoteCommandKind; error: RemoteCommandError; at: number };

export interface RemotePublicStatus {
  paired: boolean;
  serverUrl?: string;
  desktopName?: string;
  desktopId?: string;
  status: RemoteConnectorStatus;
  rendererReady: boolean;
  lastHeartbeatAt?: number;
  connectedAt?: number;
}
