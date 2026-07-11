import type {
  ChatSession,
  PermissionRequest,
  Project,
  Space,
  UIMessage,
} from "@/types";
import type {
  RemoteMessagePage,
  RemotePermissionRequest,
  RemoteSessionSnapshot,
  RemoteSessionSummary,
} from "@shared/types/remote";
import {
  toRemoteMessage,
  toRemotePermissionRequest,
  toRemoteSessionSummary,
} from "./snapshot-builder";

export interface SessionRuntimeRegistryState {
  projects: Project[];
  spaces: Space[];
  sessions: ChatSession[];
  activeSessionId: string | null;
  activeMessages: UIMessage[];
  pendingPermission: PermissionRequest | null;
}

type Listener = () => void;

function parseCursor(cursor?: string): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export class SessionRuntimeRegistry {
  private state: SessionRuntimeRegistryState = {
    projects: [],
    spaces: [],
    sessions: [],
    activeSessionId: null,
    activeMessages: [],
    pendingPermission: null,
  };
  private listeners = new Set<Listener>();
  private selectedRemoteSessionId: string | undefined;

  setState(state: SessionRuntimeRegistryState): void {
    this.state = state;
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): SessionRuntimeRegistryState {
    return this.state;
  }

  setSelectedRemoteSessionId(sessionId: string | undefined): void {
    this.selectedRemoteSessionId = sessionId;
    this.emit();
  }

  getSelectedRemoteSessionId(): string | undefined {
    return this.selectedRemoteSessionId;
  }

  listSessions(): RemoteSessionSummary[] {
    return this.state.sessions.map((session) =>
      toRemoteSessionSummary(
        session,
        this.state.activeSessionId,
        session.id === this.state.activeSessionId ? this.state.activeMessages : undefined,
      ),
    );
  }

  getSession(sessionId: string): ChatSession | undefined {
    return this.state.sessions.find((session) => session.id === sessionId);
  }

  getSnapshot(sessionId: string): RemoteSessionSnapshot | undefined {
    const session = this.getSession(sessionId);
    if (!session) return undefined;
    const messages = session.id === this.state.activeSessionId
      ? this.state.activeMessages.map(toRemoteMessage)
      : [];
    const pendingPermission = this.getPendingPermission(sessionId);
    return {
      session: toRemoteSessionSummary(session, this.state.activeSessionId, this.state.activeMessages),
      messages,
      pendingPermission,
    };
  }

  async listMessages(sessionId: string, cursor?: string, limit = 100): Promise<RemoteMessagePage> {
    const session = this.getSession(sessionId);
    if (!session) {
      return { messages: [], hasMore: false };
    }

    let messages: UIMessage[] = [];
    if (session.id === this.state.activeSessionId) {
      messages = this.state.activeMessages;
    } else {
      const persisted = await window.claude.sessions.load(session.projectId, sessionId);
      messages = persisted?.messages ?? [];
    }

    const start = parseCursor(cursor);
    const count = Math.max(1, Math.min(limit, 200));
    const page = messages.slice(start, start + count).map(toRemoteMessage);
    const nextOffset = start + page.length;
    return {
      messages: page,
      nextCursor: nextOffset < messages.length ? String(nextOffset) : undefined,
      hasMore: nextOffset < messages.length,
    };
  }

  getPendingPermission(sessionId: string): RemotePermissionRequest | undefined {
    if (!this.state.pendingPermission || this.state.activeSessionId !== sessionId) return undefined;
    const session = this.getSession(sessionId);
    return toRemotePermissionRequest({
      permission: this.state.pendingPermission,
      sessionId,
      engine: session?.engine ?? "claude",
    });
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
