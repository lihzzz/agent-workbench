import type {
  ChatSession,
  PermissionRequest,
  Project,
  Space,
  UIMessage,
} from "@/types";
import type {
  RemoteMessage,
  RemotePermissionRequest,
  RemoteProject,
  RemoteSessionSummary,
  RemoteSnapshot,
  RemoteSpace,
  StreamCursor,
} from "@shared/types/remote";

const MAX_MESSAGE_CONTENT_CHARS = 16_000;
const MAX_PERMISSION_PREVIEW_CHARS = 4_000;

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
}

export function toRemoteMessage(message: UIMessage): RemoteMessage {
  return {
    id: message.id,
    role: message.role,
    content: truncate(message.displayContent ?? message.content ?? "", MAX_MESSAGE_CONTENT_CHARS),
    timestamp: message.timestamp,
    toolName: message.toolName,
    isStreaming: message.isStreaming,
    isError: message.isError,
  };
}

export function toRemoteSessionSummary(
  session: ChatSession,
  activeSessionId: string | null,
  activeMessages?: UIMessage[],
): RemoteSessionSummary {
  return {
    id: session.id,
    projectId: session.projectId,
    title: session.title,
    engine: session.engine ?? "claude",
    model: session.model,
    lastMessageAt: session.lastMessageAt,
    createdAt: session.createdAt,
    isActive: session.id === activeSessionId,
    isProcessing: !!session.isProcessing,
    hasPendingPermission: !!session.hasPendingPermission,
    messageCount: session.id === activeSessionId ? activeMessages?.length : undefined,
  };
}

export function toRemotePermissionRequest(input: {
  permission: PermissionRequest;
  sessionId: string;
  engine: RemoteSessionSummary["engine"];
}): RemotePermissionRequest {
  const rawPreview = truncate(JSON.stringify(input.permission.toolInput, null, 2), MAX_PERMISSION_PREVIEW_CHARS);
  return {
    requestId: input.permission.requestId,
    sessionId: input.sessionId,
    engine: input.engine,
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000,
    toolName: input.permission.toolName,
    risk: "high",
    summary: input.permission.decisionReason ?? input.permission.toolName,
    rawPreview,
    allowedActions: [
      { kind: "approve_once", label: "Approve once" },
      { kind: "deny", label: "Deny" },
    ],
  };
}

export function buildRemoteSnapshot(input: {
  projects: Project[];
  spaces: Space[];
  sessions: ChatSession[];
  activeSessionId: string | null;
  activeMessages: UIMessage[];
  pendingPermission: PermissionRequest | null;
  cursor?: StreamCursor;
}): RemoteSnapshot {
  const projects: RemoteProject[] = input.projects.map((project) => ({
    id: project.id,
    name: project.name,
    path: project.path,
    spaceId: project.spaceId,
  }));
  const spaces: RemoteSpace[] = input.spaces.map((space) => ({
    id: space.id,
    name: space.name,
    icon: space.icon,
    iconType: space.iconType,
  }));
  const activeSession = input.sessions.find((session) => session.id === input.activeSessionId);
  const engine = activeSession?.engine ?? "claude";
  const pendingPermissions = input.pendingPermission && input.activeSessionId
    ? [toRemotePermissionRequest({
        permission: input.pendingPermission,
        sessionId: input.activeSessionId,
        engine,
      })]
    : [];

  return {
    app: {
      version: "renderer",
      platform: "linux",
      remoteEnabled: false,
    },
    connection: {
      desktopId: "",
      bootId: input.cursor?.bootId ?? "renderer",
      streamId: input.cursor?.streamId,
      rendererReady: true,
    },
    projects,
    spaces,
    sessions: input.sessions.map((session) =>
      toRemoteSessionSummary(
        session,
        input.activeSessionId,
        session.id === input.activeSessionId ? input.activeMessages : undefined,
      ),
    ),
    activeSessionId: input.activeSessionId ?? undefined,
    pendingPermissions,
    terminals: [],
    cursor: input.cursor ?? { bootId: "renderer", streamId: "renderer", seq: Date.now() },
  };
}
