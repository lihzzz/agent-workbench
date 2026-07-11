import type {
  RemoteChatSendPayload,
  RemoteCommandEnvelope,
  RemoteMessagesListPayload,
  RemotePermissionRespondPayload,
  RemoteSessionCommandPayload,
  RemoteSnapshot,
  RemoteStartTaskPayload,
} from "@shared/types/remote";
import type { SessionRuntimeFacade } from "./session-runtime-facade";

export class RemoteRendererBridge {
  private disposeCommandListener?: () => void;

  constructor(private readonly facade: SessionRuntimeFacade) {}

  start(): void {
    window.claude.remote.rendererReady();
    this.disposeCommandListener = window.claude.remote.onCommand((data) => {
      void this.handleCommand(data.command, data.payload);
    });
  }

  dispose(): void {
    this.disposeCommandListener?.();
    this.disposeCommandListener = undefined;
    window.claude.remote.rendererDispose();
  }

  publishSnapshot(snapshot: RemoteSnapshot): void {
    window.claude.remote.publishSnapshot(snapshot);
  }

  private async handleCommand(command: RemoteCommandEnvelope, payload: unknown): Promise<void> {
    try {
      const result = await this.execute(command, payload);
      await window.claude.remote.commandResult({
        commandId: command.id,
        ok: true,
        result,
      });
    } catch (error) {
      await window.claude.remote.commandResult({
        commandId: command.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async execute(command: RemoteCommandEnvelope, payload: unknown): Promise<unknown> {
    switch (command.kind) {
      case "messages.list": {
        const input = payload as RemoteMessagesListPayload;
        return this.facade.listMessages(input.sessionId, input.cursor, input.limit);
      }
      case "chat.send": {
        const input = payload as RemoteChatSendPayload;
        await this.facade.sendToSession(input.sessionId, { text: input.text });
        return { ok: true };
      }
      case "task.start":
        return this.facade.startTask(payload as RemoteStartTaskPayload);
      case "turn.interrupt": {
        const input = payload as RemoteSessionCommandPayload;
        await this.facade.interrupt(input.sessionId);
        return { ok: true };
      }
      case "turn.stop": {
        const input = payload as RemoteSessionCommandPayload;
        await this.facade.stop(input.sessionId);
        return { ok: true };
      }
      case "permission.respond": {
        const input = payload as RemotePermissionRespondPayload;
        await this.facade.respondPermission(input.sessionId, input.action);
        return { ok: true };
      }
      default:
        throw new Error(`Unsupported renderer remote command: ${command.kind}`);
    }
  }
}
