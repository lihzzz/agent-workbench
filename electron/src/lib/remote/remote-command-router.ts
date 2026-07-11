import type { AppSettings } from "@shared/types/settings";
import type {
  RemoteChatSendPayload,
  RemoteCommandEnvelope,
  RemoteCommandError,
  RemoteCommandErrorCode,
  RemoteCommandKind,
  RemoteCommandResultEnvelope,
  RemoteDiffFilePayload,
  RemoteMessagesListPayload,
  RemotePermissionRespondPayload,
  RemoteSessionCommandPayload,
  RemoteSnapshot,
  RemoteStartTaskPayload,
  RemoteTerminalLeaseRequestPayload,
  RemoteTerminalLeaseRevokePayload,
  RemoteTerminalPayload,
  RemoteTerminalWritePayload,
} from "@shared/types/remote";
import { REMOTE_PROTOCOL_VERSION } from "@shared/types/remote";
import type { RestrictedGitService } from "../git/restricted-git-service";
import type { RestrictedTerminalService } from "../terminal/restricted-terminal-service";
import { permissionLedger, type PermissionLedger } from "../permissions/permission-ledger";
import type { PermissionLedgerEntry } from "../permissions/permission-ledger-types";
import type { RemoteAuditStore } from "./remote-audit-store";
import { RemoteIdempotencyStore } from "./remote-idempotency-store";
import { RemoteRateLimit } from "./remote-rate-limit";
import { RemotePathAuthorizer } from "./remote-path-authorizer";
import {
  isRemoteWriteCommand,
  parseRemoteCommandEnvelope,
  parseRemotePayload,
  remoteCapabilityForCommand,
} from "./remote-schemas";
import { isRemoteHighRiskCommand, validateRemoteStepUp } from "./remote-step-up";

type RendererCommandKind =
  | "messages.list"
  | "chat.send"
  | "task.start"
  | "turn.interrupt"
  | "turn.stop"
  | "permission.respond";

type RendererCommandPayload =
  | RemoteMessagesListPayload
  | RemoteChatSendPayload
  | RemoteStartTaskPayload
  | RemoteSessionCommandPayload
  | RemotePermissionRespondPayload;

export interface RemoteRendererCommandExecutor {
  isReady: () => boolean;
  execute: (
    command: RemoteCommandEnvelope,
    payload: RendererCommandPayload,
  ) => Promise<unknown>;
}

export interface RemoteCommandRouterOptions {
  getSettings: () => AppSettings;
  getDesktopId: () => Promise<string | null>;
  getSnapshot: () => RemoteSnapshot | null;
  renderer: RemoteRendererCommandExecutor;
  git: RestrictedGitService;
  terminal: RestrictedTerminalService;
  audit: RemoteAuditStore;
  idempotency?: RemoteIdempotencyStore;
  rateLimit?: RemoteRateLimit;
  pathAuthorizer?: RemotePathAuthorizer;
  ledger?: PermissionLedger;
  respondPermission?: (
    entry: PermissionLedgerEntry,
    action: RemotePermissionRespondPayload["action"],
  ) => Promise<void>;
  isDesktopLocked?: () => boolean;
}

class RemoteRouterError extends Error {
  constructor(
    readonly code: RemoteCommandErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function commandError(code: RemoteCommandErrorCode, message: string): RemoteCommandError {
  return { code, message };
}

function fallbackKind(value: unknown): RemoteCommandKind {
  if (value && typeof value === "object" && "kind" in value) {
    const kind = (value as { kind?: unknown }).kind;
    if (typeof kind === "string") return kind as RemoteCommandKind;
  }
  return "snapshot.request";
}

function fallbackCommandId(value: unknown): string {
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return "unknown";
}

function makeResult(input: {
  desktopId: string;
  commandId: string;
  kind: RemoteCommandKind;
  result?: unknown;
  error?: RemoteCommandError;
}): RemoteCommandResultEnvelope {
  return {
    type: "command_result",
    protocolVersion: REMOTE_PROTOCOL_VERSION,
    desktopId: input.desktopId,
    commandId: input.commandId,
    kind: input.kind,
    ok: !input.error,
    result: input.error ? undefined : input.result,
    error: input.error,
    finishedAt: Date.now(),
  };
}

function normalizeThrownError(error: unknown): RemoteCommandError {
  if (error instanceof RemoteRouterError) {
    return commandError(error.code, error.message);
  }
  if (error instanceof Error) {
    return commandError("INTERNAL_ERROR", error.message);
  }
  return commandError("INTERNAL_ERROR", String(error));
}

function isRendererCommand(kind: RemoteCommandKind): kind is RendererCommandKind {
  return (
    kind === "messages.list" ||
    kind === "chat.send" ||
    kind === "task.start" ||
    kind === "turn.interrupt" ||
    kind === "turn.stop" ||
    kind === "permission.respond"
  );
}

export class RemoteCommandRouter {
  private readonly idempotency: RemoteIdempotencyStore;
  private readonly rateLimit: RemoteRateLimit;
  private readonly ledger: PermissionLedger;
  private readonly pathAuthorizer: RemotePathAuthorizer;

  constructor(private readonly options: RemoteCommandRouterOptions) {
    this.idempotency = options.idempotency ?? new RemoteIdempotencyStore();
    this.rateLimit = options.rateLimit ?? new RemoteRateLimit();
    this.ledger = options.ledger ?? permissionLedger;
    this.pathAuthorizer = options.pathAuthorizer ?? new RemotePathAuthorizer();
  }

  async route(input: unknown): Promise<RemoteCommandResultEnvelope> {
    const fallbackDesktopId = await this.options.getDesktopId() ?? "unknown";
    let command: RemoteCommandEnvelope | null = null;

    try {
      command = parseRemoteCommandEnvelope(input);
      await this.options.audit.append({
        action: "command.issued",
        desktopId: command.desktopId,
        commandId: command.id,
        userId: command.userId,
        kind: command.kind,
        risk: isRemoteHighRiskCommand(command.kind) ? "high" : "low",
        metadata: { issuedAt: command.issuedAt, deadlineAt: command.deadlineAt },
      });

      const result = await this.routeParsed(command);
      await this.options.audit.append({
        action: result.ok ? "command.accepted" : "command.rejected",
        desktopId: command.desktopId,
        commandId: command.id,
        userId: command.userId,
        kind: command.kind,
        risk: isRemoteHighRiskCommand(command.kind) ? "high" : "low",
        error: result.error,
      });
      return result;
    } catch (error) {
      const normalized = error instanceof Error && error.message === "payload exceeds byte limit"
        ? commandError("PAYLOAD_TOO_LARGE", error.message)
        : normalizeThrownError(error);
      const desktopId = command?.desktopId ?? fallbackDesktopId;
      const kind = command?.kind ?? fallbackKind(input);
      const commandId = command?.id ?? fallbackCommandId(input);
      const result = makeResult({
        desktopId,
        commandId,
        kind,
        error: normalized,
      });
      await this.options.audit.append({
        action: "command.rejected",
        desktopId,
        commandId,
        kind,
        risk: isRemoteHighRiskCommand(kind) ? "high" : "low",
        error: normalized,
      });
      return result;
    }
  }

  private async routeParsed(command: RemoteCommandEnvelope): Promise<RemoteCommandResultEnvelope> {
    const settings = this.options.getSettings();
    if (!settings.remoteControl.enabled) {
      throw new RemoteRouterError("REMOTE_DISABLED", "Remote control is disabled");
    }

    const desktopId = await this.options.getDesktopId();
    if (!desktopId) {
      throw new RemoteRouterError("REMOTE_DISABLED", "Remote control is not paired");
    }
    if (command.desktopId !== desktopId) {
      throw new RemoteRouterError("DESKTOP_MISMATCH", "Command was issued for a different desktop");
    }
    if (command.deadlineAt <= Date.now()) {
      throw new RemoteRouterError("COMMAND_EXPIRED", "Remote command deadline has passed");
    }

    const payload = parseRemotePayload(command.kind, command.payload);
    const capability = remoteCapabilityForCommand(command.kind);
    if (!settings.remoteControl.capabilities[capability]) {
      throw new RemoteRouterError("CAPABILITY_DENIED", `${capability} is disabled`);
    }

    if (this.options.isDesktopLocked?.() && isRemoteHighRiskCommand(command.kind)) {
      throw new RemoteRouterError("CAPABILITY_DENIED", "High-risk remote commands are denied while the desktop is locked");
    }

    const rate = this.rateLimit.check({ userId: command.userId, kind: command.kind });
    if (!rate.allowed) {
      throw new RemoteRouterError("RATE_LIMITED", `Remote command rate limited; retry after ${rate.retryAfterMs}ms`);
    }

    const stepUp = validateRemoteStepUp(command);
    if (!stepUp.ok) {
      throw new RemoteRouterError("STEP_UP_REQUIRED", stepUp.message);
    }

    const cached = await this.idempotency.get({
      desktopId: command.desktopId,
      commandId: command.id,
      idempotencyKey: command.idempotencyKey,
      kind: command.kind,
    });
    if (cached) return cached;

    this.validateScope(command, payload);
    const result = await this.dispatch(command, payload);
    await this.idempotency.set({
      desktopId: command.desktopId,
      commandId: command.id,
      idempotencyKey: command.idempotencyKey,
      kind: command.kind,
    }, result);
    return result;
  }

  private validateScope(command: RemoteCommandEnvelope, payload: unknown): void {
    const snapshot = this.options.getSnapshot();

    if (command.kind === "task.start") {
      const input = payload as RemoteStartTaskPayload;
      const projectId = input.projectId;
      if (snapshot && !snapshot.projects.some((project) => project.id === projectId)) {
        throw new RemoteRouterError("PATH_NOT_ALLOWED", "Project is not available to remote control");
      }
      this.pathAuthorizer.authorize({
        projectId,
        worktreeId: input.worktreeId,
      });
      return;
    }

    if (!snapshot) return;

    const sessionId = (payload as { sessionId?: unknown }).sessionId;
    if (typeof sessionId !== "string") return;
    if (!snapshot.sessions.some((session) => session.id === sessionId)) {
      throw new RemoteRouterError("SESSION_NOT_FOUND", "Session is not available to remote control");
    }
  }

  private async dispatch(command: RemoteCommandEnvelope, payload: unknown): Promise<RemoteCommandResultEnvelope> {
    try {
      const result = await this.dispatchUnsafe(command, payload);
      return makeResult({
        desktopId: command.desktopId,
        commandId: command.id,
        kind: command.kind,
        result,
      });
    } catch (error) {
      return makeResult({
        desktopId: command.desktopId,
        commandId: command.id,
        kind: command.kind,
        error: normalizeThrownError(error),
      });
    }
  }

  private async dispatchUnsafe(command: RemoteCommandEnvelope, payload: unknown): Promise<unknown> {
    switch (command.kind) {
      case "snapshot.request":
        return this.options.getSnapshot();
      case "sessions.list": {
        const snapshot = this.options.getSnapshot();
        if (snapshot) return { sessions: snapshot.sessions };
        throw new RemoteRouterError("RENDERER_UNAVAILABLE", "Renderer snapshot is unavailable");
      }
      case "diff.summary":
        return this.options.git.diffSummary((payload as { path: RemoteDiffFilePayload["path"] }).path);
      case "diff.file":
        return this.options.git.diffFile(payload as RemoteDiffFilePayload);
      case "terminal.list":
        return { terminals: this.options.terminal.list() };
      case "terminal.snapshot":
        return this.options.terminal.snapshot((payload as RemoteTerminalPayload).terminalId);
      case "terminal.subscribe":
        this.options.terminal.subscribe((payload as RemoteTerminalPayload).terminalId);
        return { ok: true };
      case "terminal.unsubscribe":
        this.options.terminal.unsubscribe((payload as RemoteTerminalPayload).terminalId);
        return { ok: true };
      case "terminal.lease.request": {
        const settings = this.options.getSettings().remoteControl;
        if (settings.terminalWriteMode !== "temporary") {
          throw new RemoteRouterError("TERMINAL_LEASE_REQUIRED", "Terminal write leases are disabled");
        }
        const requested = payload as RemoteTerminalLeaseRequestPayload;
        const ttlMs = Math.min(
          Math.max(1, requested.ttlMs ?? settings.terminalWriteTtlMs),
          settings.terminalWriteTtlMs,
        );
        return this.options.terminal.requestLease(requested.terminalId, ttlMs);
      }
      case "terminal.lease.revoke":
        this.options.terminal.revokeLease((payload as RemoteTerminalLeaseRevokePayload).leaseId);
        return { ok: true };
      case "terminal.write": {
        const settings = this.options.getSettings().remoteControl;
        if (settings.terminalWriteMode !== "temporary") {
          throw new RemoteRouterError("TERMINAL_LEASE_REQUIRED", "Terminal write leases are disabled");
        }
        const write = payload as RemoteTerminalWritePayload;
        this.options.terminal.write(write.terminalId, write.leaseId, write.data);
        await this.options.audit.append({
          action: "terminal.write",
          desktopId: command.desktopId,
          commandId: command.id,
          userId: command.userId,
          kind: command.kind,
          risk: "high",
          metadata: { terminalId: write.terminalId, data: write.data },
        });
        return { ok: true };
      }
      case "terminal.ctrl_c": {
        const ctrl = payload as Pick<RemoteTerminalWritePayload, "terminalId" | "leaseId">;
        this.options.terminal.ctrlC(ctrl.terminalId, ctrl.leaseId);
        await this.options.audit.append({
          action: "terminal.write",
          desktopId: command.desktopId,
          commandId: command.id,
          userId: command.userId,
          kind: command.kind,
          risk: "high",
          metadata: { terminalId: ctrl.terminalId, data: "\x03" },
        });
        return { ok: true };
      }
      case "permission.respond": {
        const response = payload as RemotePermissionRespondPayload;
        const claim = this.ledger.claim(response.requestId, command.id, response.action);
        if (!claim.ok) {
          const code = claim.reason === "already_resolved"
            ? "PERMISSION_ALREADY_RESOLVED"
            : "PERMISSION_NOT_FOUND";
          throw new RemoteRouterError(code, `Permission ${claim.reason}`);
        }
        if (claim.entry.sessionId !== response.sessionId) {
          this.ledger.releaseClaim(response.requestId, command.id);
          throw new RemoteRouterError("PERMISSION_NOT_FOUND", "Permission does not belong to the requested session");
        }
        try {
          if (!this.options.respondPermission) {
            throw new RemoteRouterError("INTERNAL_ERROR", "Remote permission responder is unavailable");
          }
          await this.options.respondPermission(claim.entry, response.action);
          this.ledger.resolve(response.requestId);
          await this.options.audit.append({
            action: "permission.respond",
            desktopId: command.desktopId,
            commandId: command.id,
            userId: command.userId,
            kind: command.kind,
            risk: claim.entry.risk,
            metadata: {
              sessionId: response.sessionId,
              requestId: response.requestId,
              action: response.action,
            },
          });
          return { ok: true };
        } catch (error) {
          this.ledger.releaseClaim(response.requestId, command.id);
          throw error;
        }
      }
      case "messages.list":
      case "chat.send":
      case "task.start":
      case "turn.interrupt":
      case "turn.stop":
        if (isRemoteWriteCommand(command.kind)) {
          const action = command.kind === "chat.send"
            ? "chat.send"
            : command.kind === "task.start"
              ? "task.start"
              : undefined;
          if (action) {
            await this.options.audit.append({
              action,
              desktopId: command.desktopId,
              commandId: command.id,
              userId: command.userId,
              kind: command.kind,
              risk: isRemoteHighRiskCommand(command.kind) ? "high" : "medium",
              metadata: payload as Record<string, unknown>,
            });
          }
        }
        return this.dispatchToRenderer(command, payload as RendererCommandPayload);
    }
  }

  private async dispatchToRenderer(
    command: RemoteCommandEnvelope,
    payload: RendererCommandPayload,
  ): Promise<unknown> {
    if (!isRendererCommand(command.kind)) {
      throw new RemoteRouterError("UNSUPPORTED_COMMAND", "Command is not supported by the renderer bridge");
    }
    if (!this.options.renderer.isReady()) {
      throw new RemoteRouterError("RENDERER_UNAVAILABLE", "Renderer is not ready");
    }
    return this.options.renderer.execute(command, payload);
  }
}
