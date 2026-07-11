import type {
  AppPermissionBehavior,
  ImageAttachment,
  RemoteChatInput,
  RemoteMessagePage,
  RemotePermissionAction,
  RemoteSessionSnapshot,
  RemoteSessionSummary,
  RemoteStartTaskInput,
} from "@/types";
import { buildSdkContent } from "@/lib/engine/protocol";
import type { SessionRuntimeRegistry } from "./session-runtime-registry";

interface SessionRuntimeFacadeOptions {
  sendActive: (text: string, images?: ImageAttachment[], displayText?: string) => Promise<void>;
  interruptActive: () => Promise<void>;
  stopActive: () => Promise<void>;
  respondActivePermission: (behavior: AppPermissionBehavior) => Promise<void>;
  startRemoteTask: (input: RemoteStartTaskInput) => Promise<{ sessionId: string }>;
}

function permissionActionToBehavior(action: RemotePermissionAction): AppPermissionBehavior {
  return action.kind === "deny" ? "deny" : "allow";
}

export class SessionRuntimeFacade {
  constructor(
    private readonly registry: SessionRuntimeRegistry,
    private readonly options: SessionRuntimeFacadeOptions,
  ) {}

  getSnapshot(sessionId: string): RemoteSessionSnapshot | undefined {
    return this.registry.getSnapshot(sessionId);
  }

  listSessions(): RemoteSessionSummary[] {
    return this.registry.listSessions();
  }

  listMessages(sessionId: string, cursor?: string, limit?: number): Promise<RemoteMessagePage> {
    return this.registry.listMessages(sessionId, cursor, limit);
  }

  async sendToSession(sessionId: string, input: RemoteChatInput): Promise<void> {
    const session = this.registry.getSession(sessionId);
    if (!session) throw new Error("SESSION_NOT_FOUND");
    if (session.isProcessing) throw new Error("SESSION_BUSY");

    if (session.id === this.registry.getState().activeSessionId) {
      await this.options.sendActive(input.text);
      return;
    }

    const engine = session.engine ?? "claude";
    if (engine === "acp") {
      const result = await window.claude.acp.prompt(session.id, input.text);
      if (result.error) throw new Error(result.error);
      return;
    }
    if (engine === "codex") {
      const result = await window.claude.codex.send(session.id, input.text);
      if (result.error) throw new Error(result.error);
      return;
    }
    if (engine === "opencode") {
      const result = await window.claude.opencode.send(session.id, input.text);
      if (result.error) throw new Error(result.error);
      return;
    }

    const result = await window.claude.send(session.id, {
      type: "user",
      message: { role: "user", content: buildSdkContent(input.text) },
    });
    if (result.error) throw new Error(result.error);
  }

  async startTask(input: RemoteStartTaskInput): Promise<{ sessionId: string }> {
    return this.options.startRemoteTask(input);
  }

  async interrupt(sessionId: string): Promise<void> {
    const session = this.registry.getSession(sessionId);
    if (!session) throw new Error("SESSION_NOT_FOUND");
    if (session.id === this.registry.getState().activeSessionId) {
      await this.options.interruptActive();
      return;
    }
    const engine = session.engine ?? "claude";
    const result = engine === "acp"
      ? await window.claude.acp.cancel(session.id)
      : engine === "codex"
        ? await window.claude.codex.interrupt(session.id)
        : engine === "opencode"
          ? await window.claude.opencode.interrupt(session.id)
          : await window.claude.interrupt(session.id);
    if (result?.error) throw new Error(result.error);
  }

  async stop(sessionId: string): Promise<void> {
    const session = this.registry.getSession(sessionId);
    if (!session) throw new Error("SESSION_NOT_FOUND");
    if (session.id === this.registry.getState().activeSessionId) {
      await this.options.stopActive();
      return;
    }
    const engine = session.engine ?? "claude";
    const result = engine === "acp"
      ? await window.claude.acp.stop(session.id)
      : engine === "codex"
        ? await window.claude.codex.stop(session.id)
        : engine === "opencode"
          ? await window.claude.opencode.stop(session.id)
          : await window.claude.stop(session.id, "remote");
    if (result && "error" in result && result.error) throw new Error(result.error);
  }

  async respondPermission(sessionId: string, action: RemotePermissionAction): Promise<void> {
    const state = this.registry.getState();
    if (state.activeSessionId !== sessionId || !state.pendingPermission) {
      throw new Error("PERMISSION_NOT_FOUND");
    }
    const session = this.registry.getSession(sessionId);
    if (action.kind === "answer" && session?.engine === "acp") {
      const result = await window.claude.acp.respondPermission(sessionId, state.pendingPermission.requestId, action.optionId);
      if (result.error) throw new Error(result.error);
      return;
    }
    await this.options.respondActivePermission(permissionActionToBehavior(action));
  }
}
