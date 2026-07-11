import { app, BrowserWindow, ipcMain, powerMonitor } from "electron";
import type {
  RemoteCommandEnvelope,
  RemotePermissionRequest,
  RemotePublicStatus,
  RemoteSnapshot,
  RemoteTerminalSummary,
} from "@shared/types/remote";
import { getAppSettings } from "../lib/app-settings";
import { RestrictedGitService } from "../lib/git/restricted-git-service";
import { RestrictedTerminalService } from "../lib/terminal/restricted-terminal-service";
import { RemoteAuditStore } from "../lib/remote/remote-audit-store";
import { RemoteCommandRouter } from "../lib/remote/remote-command-router";
import { RemoteConnector } from "../lib/remote/remote-connector";
import { RemoteCredentialStore } from "../lib/remote/remote-credential-store";
import { RemoteIdempotencyStore } from "../lib/remote/remote-idempotency-store";
import { RemoteRateLimit } from "../lib/remote/remote-rate-limit";
import { permissionLedger } from "../lib/permissions/permission-ledger";
import { respondPermissionFromLedger } from "../lib/permissions/permission-response-router";
import { safeSend } from "../lib/safe-send";
import { reportError } from "../lib/error-utils";
import { onSettingsChanged, updateSettings } from "./settings";

interface IpcResult {
  ok?: boolean;
  error?: string;
}

interface PairInput {
  serverUrl: string;
  desktopName: string;
  deviceToken: string;
  desktopId?: string;
}

interface PendingRendererCommand {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class RendererCommandBridge {
  private ready = false;
  private pending = new Map<string, PendingRendererCommand>();

  constructor(private readonly getMainWindow: () => BrowserWindow | null) {}

  isReady = (): boolean => this.ready;

  setReady(ready: boolean): void {
    this.ready = ready;
    if (!ready) {
      for (const [commandId, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Renderer became unavailable"));
        this.pending.delete(commandId);
      }
    }
  }

  execute = (
    command: RemoteCommandEnvelope,
    payload: unknown,
  ): Promise<unknown> => {
    const window = this.getMainWindow();
    if (!this.ready || !window || window.isDestroyed()) {
      return Promise.reject(new Error("Renderer is not ready"));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(command.id);
        reject(new Error("Renderer command timed out"));
      }, 30_000);
      this.pending.set(command.id, { resolve, reject, timer });
      safeSend(this.getMainWindow, "remote:command", { command, payload });
    });
  };

  complete(commandId: string, result: { ok: boolean; result?: unknown; error?: string }): void {
    const pending = this.pending.get(commandId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(commandId);
    if (result.ok) {
      pending.resolve(result.result);
    } else {
      pending.reject(new Error(result.error || "Remote renderer command failed"));
    }
  }
}

function normalizePlatform(): "darwin" | "win32" | "linux" {
  return process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux";
}

let connector: RemoteConnector | null = null;
let credentialStore: RemoteCredentialStore | null = null;
let auditStore: RemoteAuditStore | null = null;
let terminalService: RestrictedTerminalService | null = null;
let rendererBridge: RendererCommandBridge | null = null;
let latestRendererSnapshot: RemoteSnapshot | null = null;
let desktopLocked = false;

function ledgerPermissionToRemote(entry: ReturnType<typeof permissionLedger.list>[number]): RemotePermissionRequest {
  return {
    requestId: entry.requestId,
    sessionId: entry.sessionId,
    engine: entry.engine,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    toolName: entry.toolName,
    cwd: entry.cwd,
    risk: entry.risk,
    summary: entry.summary,
    rawPreview: entry.rawPreview,
    allowedActions: entry.allowedActions.map((action) => ({ ...action })),
  };
}

function mergeLedgerPermissions(snapshot: RemoteSnapshot): RemoteSnapshot {
  const pendingPermissions = permissionLedger.list().map(ledgerPermissionToRemote);
  if (pendingPermissions.length === 0) {
    return { ...snapshot, pendingPermissions: [] };
  }

  const sessionsWithPermission = new Set(pendingPermissions.map((permission) => permission.sessionId));
  return {
    ...snapshot,
    pendingPermissions,
    sessions: snapshot.sessions.map((session) => ({
      ...session,
      hasPendingPermission: session.hasPendingPermission || sessionsWithPermission.has(session.id),
    })),
  };
}

function buildSnapshot(): RemoteSnapshot | null {
  const status = connector?.getStatus();
  const settings = getAppSettings().remoteControl;
  const terminals: RemoteTerminalSummary[] = terminalService?.list() ?? [];
  const base = latestRendererSnapshot;
  if (base) {
    return mergeLedgerPermissions({
      ...base,
      app: {
        ...base.app,
        version: app.getVersion(),
        platform: normalizePlatform(),
        remoteEnabled: settings.enabled,
        degraded: !status?.rendererReady,
      },
      connection: {
        ...base.connection,
        desktopId: status?.desktopId ?? base.connection.desktopId,
        bootId: status?.bootId ?? base.connection.bootId,
        streamId: status?.streamId,
        connectedAt: status?.connectedAt,
        lastHeartbeatAt: status?.lastHeartbeatAt,
        rendererReady: !!status?.rendererReady,
      },
      terminals,
      cursor: connector?.getCursor() ?? base.cursor,
    });
  }

  const bootId = status?.bootId ?? "not-started";
  return mergeLedgerPermissions({
    app: {
      version: app.getVersion(),
      platform: normalizePlatform(),
      remoteEnabled: settings.enabled,
      degraded: true,
    },
    connection: {
      desktopId: status?.desktopId ?? "",
      bootId,
      streamId: status?.streamId,
      connectedAt: status?.connectedAt,
      lastHeartbeatAt: status?.lastHeartbeatAt,
      rendererReady: !!status?.rendererReady,
    },
    projects: [],
    spaces: [],
    sessions: [],
    pendingPermissions: [],
    terminals,
    cursor: connector?.getCursor() ?? { bootId, streamId: "", seq: 0 },
  });
}

async function getPublicStatus(): Promise<RemotePublicStatus> {
  const credential = await credentialStore?.getPublicState();
  const status = connector?.getStatus();
  return {
    paired: !!credential?.paired,
    serverUrl: credential?.serverUrl ?? getAppSettings().remoteControl.serverUrl,
    desktopName: credential?.desktopName ?? getAppSettings().remoteControl.desktopName,
    desktopId: credential?.desktopId ?? status?.desktopId,
    status: status?.status ?? "disabled",
    rendererReady: !!status?.rendererReady,
    lastHeartbeatAt: status?.lastHeartbeatAt,
    connectedAt: status?.connectedAt,
  };
}

function emitStatus(getMainWindow: () => BrowserWindow | null): void {
  void getPublicStatus().then((status) => {
    safeSend(getMainWindow, "remote:status-changed", status);
  });
}

export function register(getMainWindow: () => BrowserWindow | null): void {
  credentialStore = new RemoteCredentialStore();
  auditStore = new RemoteAuditStore();
  terminalService = new RestrictedTerminalService();
  rendererBridge = new RendererCommandBridge(getMainWindow);

  const router = new RemoteCommandRouter({
    getSettings: getAppSettings,
    getDesktopId: async () => (await credentialStore?.getPublicState())?.desktopId ?? null,
    getSnapshot: buildSnapshot,
    renderer: rendererBridge,
    git: new RestrictedGitService(),
    terminal: terminalService,
    audit: auditStore,
    idempotency: new RemoteIdempotencyStore(),
    rateLimit: new RemoteRateLimit(),
    respondPermission: respondPermissionFromLedger,
    isDesktopLocked: () => desktopLocked,
  });

  connector = new RemoteConnector({
    credentials: credentialStore,
    router,
    audit: auditStore,
    getSettings: getAppSettings,
    getSnapshot: buildSnapshot,
    onStatusChanged: () => emitStatus(getMainWindow),
    onDisconnectCleanup: () => terminalService?.revokeAllLeases(),
  });

  terminalService.onTerminalData = (event) => {
    connector?.emitEvent({
      type: "terminal.data",
      terminalId: event.terminalId,
      data: event.data,
      seq: event.seq,
      at: Date.now(),
    }, "transient");
  };

  powerMonitor.on("lock-screen", () => {
    desktopLocked = true;
    terminalService?.revokeAllLeases();
    connector?.publishSnapshot();
  });
  powerMonitor.on("unlock-screen", () => {
    desktopLocked = false;
    connector?.publishSnapshot();
  });
  powerMonitor.on("suspend", () => {
    desktopLocked = true;
    terminalService?.revokeAllLeases();
    connector?.publishSnapshot();
  });
  powerMonitor.on("resume", () => {
    desktopLocked = false;
    connector?.publishSnapshot();
  });

  ipcMain.handle("remote:status", async () => getPublicStatus());

  ipcMain.handle("remote:pair", async (_event, input: PairInput): Promise<IpcResult> => {
    try {
      const credential = await credentialStore!.save(input);
      const current = getAppSettings().remoteControl;
      updateSettings({
        remoteControl: {
          ...current,
          enabled: true,
          serverUrl: credential.serverUrl,
          desktopName: credential.desktopName,
        },
      }, getMainWindow);
      await auditStore!.append({
        action: "pairing",
        desktopId: credential.desktopId,
        metadata: { serverUrl: credential.serverUrl, desktopName: credential.desktopName },
      });
      emitStatus(getMainWindow);
      return { ok: true };
    } catch (error) {
      return { error: reportError("REMOTE_PAIR", error) };
    }
  });

  ipcMain.handle("remote:revoke", async (): Promise<IpcResult> => {
    try {
      const publicState = await credentialStore!.getPublicState();
      await credentialStore!.clear();
      terminalService?.revokeAllLeases();
      connector?.stop("revoked");
      const current = getAppSettings().remoteControl;
      updateSettings({
        remoteControl: {
          ...current,
          enabled: false,
        },
      }, getMainWindow);
      await auditStore!.append({ action: "revoke", desktopId: publicState.desktopId });
      emitStatus(getMainWindow);
      return { ok: true };
    } catch (error) {
      return { error: reportError("REMOTE_REVOKE", error) };
    }
  });

  ipcMain.handle("remote:set-enabled", async (_event, enabled: boolean): Promise<IpcResult> => {
    try {
      const current = getAppSettings().remoteControl;
      updateSettings({ remoteControl: { ...current, enabled: !!enabled } }, getMainWindow);
      emitStatus(getMainWindow);
      return { ok: true };
    } catch (error) {
      return { error: reportError("REMOTE_SET_ENABLED", error) };
    }
  });

  ipcMain.handle("remote:audit-list", async (_event, limit?: number) => {
    return auditStore!.list(limit);
  });

  ipcMain.handle("remote:command-result", (_event, result: {
    commandId: string;
    ok: boolean;
    result?: unknown;
    error?: string;
  }): IpcResult => {
    rendererBridge?.complete(result.commandId, result);
    return { ok: true };
  });

  ipcMain.on("remote:renderer-ready", () => {
    rendererBridge?.setReady(true);
    connector?.setRendererReady(true);
    emitStatus(getMainWindow);
  });

  ipcMain.on("remote:renderer-dispose", () => {
    rendererBridge?.setReady(false);
    connector?.setRendererReady(false);
    emitStatus(getMainWindow);
  });

  ipcMain.on("remote:snapshot-update", (_event, snapshot: RemoteSnapshot) => {
    latestRendererSnapshot = snapshot;
    connector?.publishSnapshot();
  });

  onSettingsChanged((settings) => {
    if (!connector) return;
    if (settings.remoteControl.enabled) {
      void connector.start();
    } else {
      terminalService?.revokeAllLeases();
      connector.stop("disabled");
    }
    connector.publishSnapshot();
    emitStatus(getMainWindow);
  });

  void connector.start();
}
