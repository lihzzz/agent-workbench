import { app } from "electron";
import crypto from "crypto";
import type {
  RemoteConnectorStatus,
  RemoteControlPublicSettings,
  RemoteEvent,
  RemoteEventRetention,
  RemoteHeartbeatEnvelope,
  RemoteHelloEnvelope,
  RemoteSnapshot,
  RemoteSnapshotEnvelope,
  StreamCursor,
} from "@shared/types/remote";
import { REMOTE_PROTOCOL_VERSION } from "@shared/types/remote";
import type { RemoteCommandRouter } from "./remote-command-router";
import type { RemoteCredential, RemoteCredentialStore } from "./remote-credential-store";
import type { RemoteAuditStore } from "./remote-audit-store";
import { log } from "../logger";

interface RemoteConnectorOptions {
  credentials: RemoteCredentialStore;
  router: RemoteCommandRouter;
  audit: RemoteAuditStore;
  getSettings: () => { remoteControl: RemoteControlPublicSettings };
  getSnapshot: () => RemoteSnapshot | null;
  onStatusChanged?: () => void;
  onDisconnectCleanup?: () => void;
}

const HEARTBEAT_MS = 15_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

function makeStreamId(): string {
  return crypto.randomUUID();
}

function toWebSocketUrl(serverUrl: string, credential: RemoteCredential): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "http:" ? "ws:" : url.protocol === "https:" ? "wss:" : url.protocol;
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws/desktop`;
  url.searchParams.set("desktopId", credential.desktopId);
  url.searchParams.set("token", credential.deviceToken);
  return url.toString();
}

export class RemoteConnector {
  readonly bootId = crypto.randomUUID();
  private status: RemoteConnectorStatus = "disabled";
  private rendererReady = false;
  private desktopId: string | undefined;
  private streamId: string | undefined;
  private seq = 0;
  private connectedAt: number | undefined;
  private lastHeartbeatAt: number | undefined;
  private socket: WebSocket | null = null;
  private socketKey: string | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private backoffTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectBackoffMs = INITIAL_BACKOFF_MS;
  private stopping = false;

  constructor(private readonly options: RemoteConnectorOptions) {}

  getStatus(): {
    status: RemoteConnectorStatus;
    rendererReady: boolean;
    desktopId?: string;
    bootId: string;
    streamId?: string;
    connectedAt?: number;
    lastHeartbeatAt?: number;
  } {
    return {
      status: this.status,
      rendererReady: this.rendererReady,
      desktopId: this.desktopId,
      bootId: this.bootId,
      streamId: this.streamId,
      connectedAt: this.connectedAt,
      lastHeartbeatAt: this.lastHeartbeatAt,
    };
  }

  getCursor(): StreamCursor {
    return {
      bootId: this.bootId,
      streamId: this.streamId ?? "",
      seq: this.seq,
    };
  }

  async start(): Promise<void> {
    this.stopping = false;
    const settings = this.options.getSettings().remoteControl;
    if (!settings.enabled) {
      this.setStatus("disabled");
      return;
    }
    const credential = await this.options.credentials.get();
    if (!credential) {
      this.setStatus("pairing");
      return;
    }
    this.desktopId = credential.desktopId;
    this.connect(credential);
  }

  stop(status: RemoteConnectorStatus = "disabled"): void {
    this.stopping = true;
    this.clearTimers();
    this.options.onDisconnectCleanup?.();
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Ignore close failures.
      }
      this.socket = null;
    }
    this.socketKey = undefined;
    this.streamId = undefined;
    this.connectedAt = undefined;
    this.lastHeartbeatAt = undefined;
    this.setStatus(status);
  }

  setRendererReady(ready: boolean): void {
    if (this.rendererReady === ready) return;
    this.rendererReady = ready;
    this.options.onStatusChanged?.();
    this.sendHeartbeat();
    this.sendSnapshot();
  }

  publishSnapshot(): void {
    this.sendSnapshot();
  }

  emitEvent(event: RemoteEvent, retention: RemoteEventRetention): void {
    if (!this.isOpen()) return;
    const cursor = this.nextCursor();
    this.sendJson({
      type: "event",
      protocolVersion: REMOTE_PROTOCOL_VERSION,
      desktopId: this.desktopId ?? "",
      cursor,
      retention,
      event,
    });
  }

  private connect(credential: RemoteCredential): void {
    const wsUrl = toWebSocketUrl(credential.serverUrl, credential);
    const readyState = this.socket?.readyState;
    if (
      this.socketKey === wsUrl &&
      (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING)
    ) {
      this.setStatus(readyState === WebSocket.OPEN ? "connected" : "connecting");
      if (readyState === WebSocket.OPEN) {
        this.sendHeartbeat();
        this.sendSnapshot();
      }
      return;
    }

    this.clearTimers();
    this.setStatus("connecting");
    this.streamId = makeStreamId();
    this.seq = 0;
    log("REMOTE", `Connecting desktop remote control to ${credential.serverUrl}`);

    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Ignore close failures on a superseded socket.
      }
      this.socket = null;
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl);
    } catch (error) {
      log("REMOTE", `WebSocket creation failed: ${error instanceof Error ? error.message : String(error)}`);
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    this.socketKey = wsUrl;
    socket.addEventListener("open", () => {
      if (this.socket !== socket) {
        socket.close();
        return;
      }
      this.reconnectBackoffMs = INITIAL_BACKOFF_MS;
      this.connectedAt = Date.now();
      this.setStatus("connected");
      void this.options.audit.append({
        action: "connector.connected",
        desktopId: credential.desktopId,
        metadata: { serverUrl: credential.serverUrl },
      });
      this.sendHello(credential);
      this.sendHeartbeat();
      this.sendSnapshot();
      this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_MS);
    });

    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      void this.handleMessage(event.data);
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.socketKey = undefined;
      this.clearHeartbeat();
      this.options.onDisconnectCleanup?.();
      void this.options.audit.append({
        action: "connector.disconnected",
        desktopId: credential.desktopId,
      });
      if (!this.stopping) this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      if (this.socket !== socket) return;
      if (!this.stopping) {
        this.setStatus("backoff");
      }
    });
  }

  private async handleMessage(data: unknown): Promise<void> {
    let parsed: unknown;
    try {
      parsed = typeof data === "string" ? JSON.parse(data) : JSON.parse(String(data));
    } catch {
      return;
    }

    if (parsed && typeof parsed === "object" && "type" in parsed && (parsed as { type?: unknown }).type === "revoked") {
      await this.options.credentials.clear();
      this.stop("revoked");
      void this.options.audit.append({ action: "revoke", desktopId: this.desktopId });
      return;
    }

    const result = await this.options.router.route(parsed);
    this.sendJson(result);
  }

  private scheduleReconnect(): void {
    this.setStatus("backoff");
    this.clearTimers();
    const delay = this.reconnectBackoffMs;
    this.reconnectBackoffMs = Math.min(this.reconnectBackoffMs * 2, MAX_BACKOFF_MS);
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null;
      void this.start();
    }, delay);
  }

  private sendHello(credential: RemoteCredential): void {
    const settings = this.options.getSettings().remoteControl;
    const hello: RemoteHelloEnvelope = {
      type: "hello",
      protocolVersion: REMOTE_PROTOCOL_VERSION,
      desktopId: credential.desktopId,
      desktopName: credential.desktopName,
      appVersion: app.getVersion(),
      capabilities: settings.capabilities,
      bootId: this.bootId,
    };
    this.sendJson(hello);
  }

  private sendHeartbeat(): void {
    if (!this.isOpen() || !this.desktopId || !this.streamId) return;
    this.lastHeartbeatAt = Date.now();
    const heartbeat: RemoteHeartbeatEnvelope = {
      type: "heartbeat",
      protocolVersion: REMOTE_PROTOCOL_VERSION,
      desktopId: this.desktopId,
      bootId: this.bootId,
      streamId: this.streamId,
      sentAt: this.lastHeartbeatAt,
      rendererReady: this.rendererReady,
    };
    this.sendJson(heartbeat);
    this.options.onStatusChanged?.();
  }

  private sendSnapshot(): void {
    if (!this.isOpen() || !this.desktopId) return;
    const snapshot = this.options.getSnapshot();
    if (!snapshot) return;
    const envelope: RemoteSnapshotEnvelope = {
      type: "snapshot",
      protocolVersion: REMOTE_PROTOCOL_VERSION,
      desktopId: this.desktopId,
      snapshot,
    };
    this.sendJson(envelope);
  }

  private nextCursor(): StreamCursor {
    return {
      bootId: this.bootId,
      streamId: this.streamId ?? "",
      seq: ++this.seq,
    };
  }

  private sendJson(value: unknown): void {
    if (!this.isOpen()) return;
    this.socket?.send(JSON.stringify(value));
  }

  private isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private clearHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }
  }

  private setStatus(status: RemoteConnectorStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatusChanged?.();
    if (this.desktopId) {
      this.emitEvent({ type: "connector.status", status, at: Date.now() }, "persistent");
    }
  }
}
