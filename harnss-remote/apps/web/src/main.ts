import type {
  RemoteCommandKind,
  RemoteCommandResultEnvelope,
  RemotePermissionAction,
  RemoteSnapshot,
} from "@harnss-remote/protocol";
import "./styles.css";

type RemoteSessionSummary = RemoteSnapshot["sessions"][number];
type SessionFilter = "all" | "active" | "running" | "attention";
type DesktopConnectionStatus = "online" | "offline";

interface RemoteMessage {
  id: string;
  role: "user" | "assistant" | "tool_call" | "tool_result" | "system" | "summary";
  content: string;
  timestamp: number;
  toolName?: string;
  isStreaming?: boolean;
  isError?: boolean;
}

interface RemoteMessagePage {
  messages: RemoteMessage[];
  nextCursor?: string;
  hasMore: boolean;
}

interface MessageState extends RemoteMessagePage {
  loading: boolean;
  error?: string;
}

interface CommandContext {
  kind: RemoteCommandKind;
  sessionId?: string;
  appendMessages?: boolean;
}

interface State {
  user: { id: string; email: string } | null;
  snapshot: RemoteSnapshot | null;
  selectedSessionId: string | null;
  sessionQuery: string;
  sessionFilter: SessionFilter;
  commandStatus: string;
  diffOutput: string;
  terminalOutput: string;
  messagesBySessionId: Record<string, MessageState>;
}

const state: State = {
  user: null,
  snapshot: null,
  selectedSessionId: null,
  sessionQuery: "",
  sessionFilter: "all",
  commandStatus: "",
  diffOutput: "",
  terminalOutput: "",
  messagesBySessionId: {},
};

const app = document.querySelector<HTMLDivElement>("#app");
let socket: WebSocket | null = null;
const commandContexts = new Map<string, CommandContext>();

function qs<T extends HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

function wsUrl(path: string): string {
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(timestamp?: number): string {
  if (!timestamp) return "No activity";
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function lastSeenTimestamp(snapshot: RemoteSnapshot | null): number | undefined {
  return snapshot?.connection.serverLastSeenAt ??
    snapshot?.connection.lastHeartbeatAt ??
    snapshot?.connection.connectedAt;
}

function isDesktopOnline(snapshot = state.snapshot): boolean {
  if (!snapshot) return false;
  if (typeof snapshot.connection.online === "boolean") return snapshot.connection.online;
  const lastSeen = lastSeenTimestamp(snapshot);
  return !!lastSeen && Date.now() - lastSeen < 45_000;
}

function canSendRemoteCommand(snapshot = state.snapshot): boolean {
  return !!snapshot && isDesktopOnline(snapshot) && snapshot.connection.rendererReady;
}

function commandBlockedText(snapshot = state.snapshot): string {
  if (!snapshot) return "No desktop snapshot is available.";
  if (!isDesktopOnline(snapshot)) {
    return `Desktop is disconnected. Showing the last snapshot from ${formatDate(lastSeenTimestamp(snapshot))}.`;
  }
  if (!snapshot.connection.rendererReady) return "Desktop is online, but the renderer bridge is not ready.";
  return "Remote commands are paused.";
}

function commandResultText(result: RemoteCommandResultEnvelope | undefined): string {
  if (!result) return "Command completed";
  if (result.ok) return `${result.kind}: succeeded`;
  const code = result.error?.code ?? "COMMAND_FAILED";
  const message = result.error?.message ?? "Command failed";
  return `${result.kind}: ${code} - ${message}`;
}

function isRemoteMessage(value: unknown): value is RemoteMessage {
  return !!value && typeof value === "object" &&
    typeof (value as RemoteMessage).id === "string" &&
    typeof (value as RemoteMessage).role === "string" &&
    typeof (value as RemoteMessage).content === "string" &&
    typeof (value as RemoteMessage).timestamp === "number";
}

function isRemoteMessagePage(value: unknown): value is RemoteMessagePage {
  if (!value || typeof value !== "object") return false;
  const page = value as RemoteMessagePage;
  return Array.isArray(page.messages) &&
    page.messages.every(isRemoteMessage) &&
    typeof page.hasMore === "boolean";
}

function stringifyResult(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function ensureSelectedSession(snapshot: RemoteSnapshot | null): void {
  if (!snapshot) {
    state.selectedSessionId = null;
    return;
  }
  if (state.selectedSessionId && snapshot.sessions.some((session) => session.id === state.selectedSessionId)) {
    return;
  }
  state.selectedSessionId = snapshot.activeSessionId ?? snapshot.sessions[0]?.id ?? null;
}

function selectedSession(snapshot = state.snapshot): RemoteSessionSummary | undefined {
  if (!snapshot || !state.selectedSessionId) return undefined;
  return snapshot.sessions.find((session) => session.id === state.selectedSessionId);
}

function messageCursorForSession(session: RemoteSessionSummary | undefined): string | undefined {
  if (!session?.messageCount) return undefined;
  const start = Math.max(0, session.messageCount - 80);
  return start > 0 ? String(start) : undefined;
}

function mergeMessagePage(sessionId: string, page: RemoteMessagePage, appendMessages: boolean): void {
  const current = state.messagesBySessionId[sessionId];
  const messages = appendMessages ? [...(current?.messages ?? []), ...page.messages] : page.messages;
  state.messagesBySessionId[sessionId] = {
    messages,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    loading: false,
  };
}

function handleCommandResult(result: RemoteCommandResultEnvelope | undefined): void {
  const context = result ? commandContexts.get(result.commandId) : undefined;
  if (result) commandContexts.delete(result.commandId);

  if (result?.kind === "messages.list") {
    const sessionId = context?.sessionId ?? state.selectedSessionId;
    if (!sessionId) return;
    if (!result.ok) {
      state.messagesBySessionId[sessionId] = {
        messages: state.messagesBySessionId[sessionId]?.messages ?? [],
        nextCursor: state.messagesBySessionId[sessionId]?.nextCursor,
        hasMore: state.messagesBySessionId[sessionId]?.hasMore ?? false,
        loading: false,
        error: result.error?.message ?? "Unable to load messages",
      };
      return;
    }
    if (isRemoteMessagePage(result.result)) {
      mergeMessagePage(sessionId, result.result, !!context?.appendMessages);
      return;
    }
    state.messagesBySessionId[sessionId] = {
      messages: state.messagesBySessionId[sessionId]?.messages ?? [],
      hasMore: false,
      loading: false,
      error: "Unexpected message payload",
    };
    return;
  }

  state.commandStatus = commandResultText(result);

  if (result?.kind === "chat.send" && result.ok) {
    const sessionId = context?.sessionId ?? state.selectedSessionId;
    if (sessionId) void loadMessages(sessionId, true);
  }

  if (result?.kind === "diff.summary") {
    state.diffOutput = result.ok ? stringifyResult(result.result) : commandResultText(result);
  }

  if (result?.kind === "terminal.snapshot") {
    state.terminalOutput = result.ok ? stringifyResult(result.result) : commandResultText(result);
  }
}

async function loadMe(): Promise<void> {
  try {
    state.user = await api<{ id: string; email: string }>("/api/me");
    state.snapshot = await api<RemoteSnapshot>("/api/snapshot").catch(() => null);
    ensureSelectedSession(state.snapshot);
    await openSocket();
    if (state.selectedSessionId && canSendRemoteCommand() && !state.messagesBySessionId[state.selectedSessionId]) {
      void loadMessages(state.selectedSessionId, true);
    }
  } catch {
    state.user = null;
  }
}

function openSocket(): Promise<void> {
  if (socket) socket.close();
  socket = new WebSocket(wsUrl("/ws/client"));
  const ready = new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    socket?.addEventListener("open", done, { once: true });
    socket?.addEventListener("error", done, { once: true });
    window.setTimeout(done, 1200);
  });
  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data as string) as {
      type: string;
      desktopId?: string;
      status?: DesktopConnectionStatus;
      lastSeenAt?: number;
      snapshot?: RemoteSnapshot;
      result?: RemoteCommandResultEnvelope;
    };
    if (data.type === "snapshot" && data.snapshot) {
      state.snapshot = data.snapshot;
      ensureSelectedSession(data.snapshot);
      if (state.selectedSessionId && canSendRemoteCommand(data.snapshot) && !state.messagesBySessionId[state.selectedSessionId]) {
        void loadMessages(state.selectedSessionId, true);
      }
      render();
    }
    if (data.type === "command_result") {
      handleCommandResult(data.result);
      render();
    }
    if (data.type === "desktop_status" && state.snapshot && data.desktopId === state.snapshot.connection.desktopId) {
      state.snapshot = {
        ...state.snapshot,
        connection: {
          ...state.snapshot.connection,
          online: data.status === "online",
          serverStatus: data.status,
          serverLastSeenAt: data.lastSeenAt ?? state.snapshot.connection.serverLastSeenAt,
        },
      };
      state.commandStatus = data.status === "online"
        ? "Desktop connected"
        : "Desktop disconnected. Commands are paused.";
      render();
    }
  });
  return ready;
}

async function login(email: string, password: string): Promise<void> {
  await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  await loadMe();
  render();
}

async function stepUp(password: string): Promise<string> {
  const receipt = await api<{ id: string }>("/api/auth/step-up", {
    method: "POST",
    body: JSON.stringify({ password, level: "high_risk" }),
  });
  return receipt.id;
}

async function sendCommand(
  kind: RemoteCommandKind,
  payload?: unknown,
  highRisk = false,
  options: { silent?: boolean; sessionId?: string; appendMessages?: boolean } = {},
): Promise<string | null> {
  const snapshot = state.snapshot;
  if (!snapshot || !canSendRemoteCommand(snapshot)) {
    if (!options.silent) state.commandStatus = commandBlockedText(snapshot);
    render();
    return null;
  }
  let stepUpReceiptId: string | undefined;
  if (highRisk) {
    const password = window.prompt("Password") ?? "";
    if (!password) return null;
    stepUpReceiptId = await stepUp(password);
  }

  try {
    const result = await api<{ commandId: string; status: string }>("/api/commands", {
      method: "POST",
      body: JSON.stringify({
        desktopId: snapshot.connection.desktopId,
        kind,
        payload,
        stepUpReceiptId,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    commandContexts.set(result.commandId, {
      kind,
      sessionId: options.sessionId,
      appendMessages: options.appendMessages,
    });
    if (!options.silent) state.commandStatus = `${kind}: ${result.status}`;
    return result.commandId;
  } catch (error) {
    if (!options.silent) state.commandStatus = `${kind}: ${error instanceof Error ? error.message : String(error)}`;
    return null;
  } finally {
    render();
  }
}

async function loadMessages(sessionId: string, replace = true): Promise<void> {
  if (!canSendRemoteCommand()) {
    const current = state.messagesBySessionId[sessionId];
    state.messagesBySessionId[sessionId] = {
      messages: current?.messages ?? [],
      nextCursor: current?.nextCursor,
      hasMore: current?.hasMore ?? false,
      loading: false,
      error: commandBlockedText(),
    };
    render();
    return;
  }
  const session = state.snapshot?.sessions.find((item) => item.id === sessionId);
  const current = state.messagesBySessionId[sessionId];
  if (current?.loading) return;
  const cursor = replace ? messageCursorForSession(session) : current?.nextCursor;
  state.messagesBySessionId[sessionId] = {
    messages: replace ? [] : current?.messages ?? [],
    nextCursor: replace ? undefined : current?.nextCursor,
    hasMore: replace ? false : current?.hasMore ?? false,
    loading: true,
  };
  render();

  const commandId = await sendCommand(
    "messages.list",
    { sessionId, cursor, limit: 80 },
    false,
    { silent: true, sessionId, appendMessages: !replace },
  );
  if (!commandId) {
    state.messagesBySessionId[sessionId] = {
      messages: state.messagesBySessionId[sessionId]?.messages ?? [],
      nextCursor: state.messagesBySessionId[sessionId]?.nextCursor,
      hasMore: state.messagesBySessionId[sessionId]?.hasMore ?? false,
      loading: false,
      error: "Unable to request messages",
    };
    render();
  }
}

function loginView(): string {
  return `
    <main class="login">
      <section class="login-panel">
        <div>
          <p class="eyebrow">Desktop relay</p>
          <h1>Harnss Remote</h1>
          <p class="login-copy">Sign in to monitor sessions, read messages, and send controlled commands to your paired desktop.</p>
        </div>
        <form id="login-form" class="login-form">
          <label>
            <span>Email</span>
            <input name="email" placeholder="admin@example.com" autocomplete="username" />
          </label>
          <label>
            <span>Password</span>
            <input name="password" placeholder="Password" type="password" autocomplete="current-password" />
          </label>
          <button class="primary-action">Sign in</button>
        </form>
      </section>
    </main>
  `;
}

function statusText(snapshot: RemoteSnapshot | null): string {
  if (!snapshot) return "offline";
  if (!isDesktopOnline(snapshot)) return "offline";
  if (!snapshot.connection.rendererReady) return "degraded";
  return "online";
}

function statusLabel(snapshot: RemoteSnapshot | null): string {
  if (!snapshot) return "Offline";
  if (!isDesktopOnline(snapshot)) return "Disconnected";
  if (!snapshot.connection.rendererReady) return "Renderer not ready";
  return "Connected";
}

function statusSummary(snapshot: RemoteSnapshot | null): string {
  if (!snapshot) return "No snapshot";
  return `${snapshot.sessions.length} sessions · ${snapshot.pendingPermissions.length} permissions · Last seen ${formatDate(lastSeenTimestamp(snapshot))}`;
}

function connectionNotice(snapshot: RemoteSnapshot | null): string {
  if (!snapshot || canSendRemoteCommand(snapshot)) return "";
  const mode = isDesktopOnline(snapshot) ? "degraded" : "offline";
  return `
    <div class="connection-banner ${mode}">
      <strong>${escapeHtml(statusLabel(snapshot))}</strong>
      <span>${escapeHtml(commandBlockedText(snapshot))}</span>
    </div>
  `;
}

function shell(): string {
  const snapshot = state.snapshot;
  return `
    <main class="app-shell">
      <header class="topbar">
        <div class="brand">
          <span class="status-dot ${statusText(snapshot)}"></span>
          <div>
            <strong>Harnss Remote</strong>
            <span>${statusLabel(snapshot)}${snapshot?.connection.desktopId ? ` · ${snapshot.connection.desktopId.slice(0, 8)}` : ""}</span>
          </div>
        </div>
        <div class="topbar-actions">
          <span class="status-summary">${statusSummary(snapshot)}</span>
          <span class="user-pill">${escapeHtml(state.user?.email ?? "")}</span>
          <button id="refresh" class="ghost-action">Refresh</button>
        </div>
      </header>
      <section class="workspace">
        ${sessionsPane(snapshot)}
        ${chatPane(snapshot)}
      </section>
    </main>
  `;
}

function sessionMatchesFilter(session: RemoteSessionSummary): boolean {
  if (state.sessionFilter === "active") return session.isActive;
  if (state.sessionFilter === "running") return session.isProcessing;
  if (state.sessionFilter === "attention") return session.hasPendingPermission;
  return true;
}

function filteredSessions(snapshot: RemoteSnapshot | null): RemoteSessionSummary[] {
  if (!snapshot) return [];
  const query = state.sessionQuery.trim().toLowerCase();
  return snapshot.sessions.filter((session) => {
    const matchesQuery = !query ||
      session.title.toLowerCase().includes(query) ||
      session.engine.toLowerCase().includes(query) ||
      session.model?.toLowerCase().includes(query);
    return matchesQuery && sessionMatchesFilter(session);
  });
}

function filterButton(filter: SessionFilter, label: string, count?: number): string {
  const suffix = typeof count === "number" ? ` ${count}` : "";
  return `<button data-filter="${filter}" class="filter-chip ${state.sessionFilter === filter ? "active" : ""}">${label}${suffix}</button>`;
}

function sessionsPane(snapshot: RemoteSnapshot | null): string {
  const sessions = filteredSessions(snapshot);
  const total = snapshot?.sessions.length ?? 0;
  const running = snapshot?.sessions.filter((session) => session.isProcessing).length ?? 0;
  const attention = snapshot?.sessions.filter((session) => session.hasPendingPermission).length ?? 0;

  return `
    <aside class="sessions-pane">
      <div class="pane-heading">
        <div>
          <p class="eyebrow">Sessions</p>
          <h2>${total}</h2>
        </div>
        <span>${running} running</span>
      </div>
      <input id="session-search" class="search-input" value="${escapeHtml(state.sessionQuery)}" placeholder="Search sessions" />
      <div class="filter-row">
        ${filterButton("all", "All", total)}
        ${filterButton("active", "Active")}
        ${filterButton("running", "Running", running)}
        ${filterButton("attention", "Action", attention)}
      </div>
      <div class="session-list">
        ${sessions.length === 0 ? `<div class="empty compact">No matching sessions.</div>` : ""}
        ${sessions.map(renderSessionItem).join("")}
      </div>
    </aside>
  `;
}

function renderSessionItem(session: RemoteSessionSummary): string {
  const selected = session.id === state.selectedSessionId;
  const stateLabel = session.hasPendingPermission ? "needs approval" : session.isProcessing ? "running" : "idle";
  return `
    <button class="session-item ${selected ? "selected" : ""}" data-session-id="${session.id}">
      <span class="session-item-top">
        <strong>${escapeHtml(session.title || "Untitled session")}</strong>
        <span class="session-state ${stateLabel.replace(" ", "-")}">${stateLabel}</span>
      </span>
      <span class="session-item-meta">
        <span>${escapeHtml(session.engine)}</span>
        ${session.model ? `<span>${escapeHtml(session.model)}</span>` : ""}
        <span>${formatDate(session.lastMessageAt)}</span>
      </span>
    </button>
  `;
}

function chatPane(snapshot: RemoteSnapshot | null): string {
  if (!snapshot) {
    return `
      <section class="chat-pane">
        <div class="empty-state">
          <h2>No desktop snapshot</h2>
          <p>The paired desktop has not published a snapshot yet.</p>
        </div>
      </section>
    `;
  }

  const session = selectedSession(snapshot);
  if (!session) {
    return `
      <section class="chat-pane">
        <div class="empty-state">
          <h2>Select a session</h2>
          <p>Choose a desktop session from the left pane to inspect messages and send a reply.</p>
        </div>
      </section>
    `;
  }

  const messageState = state.messagesBySessionId[session.id];
  const commandReady = canSendRemoteCommand(snapshot);
  return `
    <section class="chat-pane">
      <div class="chat-header">
        <div>
          <p class="eyebrow">Current conversation</p>
          <h1>${escapeHtml(session.title || "Untitled session")}</h1>
          <div class="session-meta">
            <span>${escapeHtml(session.engine)}</span>
            ${session.model ? `<span>${escapeHtml(session.model)}</span>` : ""}
            <span>${session.isProcessing ? "running" : "idle"}</span>
            <span>${session.messageCount ?? messageState?.messages.length ?? 0} messages</span>
            <span>${formatDate(session.lastMessageAt)}</span>
          </div>
        </div>
        <div class="chat-header-actions">
          <button id="refresh-messages" class="ghost-action" ${commandReady ? "" : "disabled"}>Refresh</button>
          ${messageState?.hasMore ? `<button id="load-more-messages" class="ghost-action" ${commandReady ? "" : "disabled"}>Load more</button>` : ""}
        </div>
      </div>
      ${connectionNotice(snapshot)}
      <div class="message-list" id="message-list">
        ${renderMessages(messageState)}
      </div>
      <form id="send-chat-form" class="composer">
        <textarea
          id="chat-text"
          rows="3"
          placeholder="${commandReady ? "Send a message to this desktop session" : "Desktop is not currently operable from Web"}"
          ${commandReady ? "" : "disabled"}
        ></textarea>
        <div class="composer-actions">
          <small>${escapeHtml(state.commandStatus || (commandReady ? "Remote commands use the desktop capability policy." : commandBlockedText(snapshot)))}</small>
          <button class="primary-action" ${commandReady ? "" : "disabled"}>Send</button>
        </div>
      </form>
      ${workspaceDrawer(snapshot)}
    </section>
  `;
}

function renderMessages(messageState: MessageState | undefined): string {
  if (!messageState) return `<div class="empty-state compact"><p>Messages are not loaded yet.</p></div>`;
  if (messageState.loading && messageState.messages.length === 0) {
    return `<div class="empty-state compact"><p>Loading messages...</p></div>`;
  }
  if (messageState.error) {
    return `<div class="empty-state compact"><p>${escapeHtml(messageState.error)}</p></div>`;
  }
  if (messageState.messages.length === 0) {
    return `<div class="empty-state compact"><p>No messages in this page.</p></div>`;
  }
  return renderMessageTimeline(messageState.messages);
}

function isToolMessage(message: RemoteMessage): boolean {
  return message.role === "tool_call" || message.role === "tool_result";
}

function renderMessageTimeline(messages: RemoteMessage[]): string {
  const rows: string[] = [];
  for (let index = 0; index < messages.length;) {
    const message = messages[index];
    if (isToolMessage(message)) {
      const group: RemoteMessage[] = [];
      while (index < messages.length && isToolMessage(messages[index])) {
        group.push(messages[index]);
        index += 1;
      }
      rows.push(renderToolGroup(group));
      continue;
    }
    rows.push(renderMessage(message));
    index += 1;
  }
  return rows.join("");
}

function toolName(message: RemoteMessage): string {
  return message.toolName || message.content.split("\n", 1)[0] || "Tool";
}

function toolGroupSummary(messages: RemoteMessage[]): string {
  const counts = new Map<string, number>();
  for (const message of messages) {
    counts.set(toolName(message), (counts.get(toolName(message)) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => count > 1 ? `${name} x${count}` : name)
    .join(", ");
}

function toolGroupStatus(messages: RemoteMessage[]): string {
  if (messages.some((message) => message.isError)) return "failed";
  if (messages.some((message) => message.content.trim())) return "completed";
  return "no output";
}

function renderToolGroup(messages: RemoteMessage[]): string {
  const summary = toolGroupSummary(messages);
  const status = toolGroupStatus(messages);
  return `
    <details class="tool-group">
      <summary>
        <span class="tool-disclosure">›</span>
        <strong>${escapeHtml(summary || "Tool call")}</strong>
        <span>${messages.length} ${messages.length === 1 ? "event" : "events"} · ${status} · ${formatDate(messages[messages.length - 1]?.timestamp)}</span>
      </summary>
      <div class="tool-events">
        ${messages.map(renderToolEvent).join("")}
      </div>
    </details>
  `;
}

function renderToolEvent(message: RemoteMessage): string {
  const content = message.content.trim();
  return `
    <article class="tool-event ${message.isError ? "error" : ""}">
      <div class="tool-event-meta">
        <strong>${escapeHtml(toolName(message))}</strong>
        <span>${message.role === "tool_call" ? "call" : "result"} · ${formatDate(message.timestamp)}</span>
      </div>
      ${content ? `<pre>${escapeHtml(content)}</pre>` : `<p>No captured input or output.</p>`}
    </article>
  `;
}

function renderMessage(message: RemoteMessage): string {
  const roleClass = `role-${message.role.replace("_", "-")}`;
  const title = message.role.replace("_", " ");
  return `
    <article class="message ${roleClass} ${message.isError ? "error" : ""}">
      <div class="message-meta">
        <strong>${escapeHtml(title)}</strong>
        <span>${formatDate(message.timestamp)}${message.isStreaming ? " · streaming" : ""}</span>
      </div>
      <pre>${escapeHtml(message.content || "(empty)")}</pre>
    </article>
  `;
}

function workspaceDrawer(snapshot: RemoteSnapshot | null): string {
  if (!snapshot) return "";
  const activeProjectId = selectedSession(snapshot)?.projectId ?? snapshot.projects[0]?.id;
  const commandReady = canSendRemoteCommand(snapshot);
  return `
    <details class="workspace-drawer">
      <summary>Workspace details</summary>
      <div class="workspace-detail-grid">
        <section>
          <div class="section-heading">
            <p class="eyebrow">Permissions</p>
            <strong>${snapshot.pendingPermissions.length}</strong>
          </div>
          ${renderPermissions(snapshot)}
        </section>
        <section>
          <div class="section-heading">
            <p class="eyebrow">Changes</p>
            <button id="diff-summary" class="ghost-action" ${activeProjectId && commandReady ? "" : "disabled"}>Load</button>
          </div>
          <pre class="output-block">${escapeHtml(state.diffOutput || "No diff loaded.")}</pre>
        </section>
        <section>
          <div class="section-heading">
            <p class="eyebrow">Terminals</p>
            <strong>${snapshot.terminals.length}</strong>
          </div>
          ${renderTerminals(snapshot)}
          <pre class="output-block">${escapeHtml(state.terminalOutput || "No terminal snapshot loaded.")}</pre>
        </section>
      </div>
    </details>
  `;
}

function renderPermissions(snapshot: RemoteSnapshot | null): string {
  const permissions = snapshot?.pendingPermissions ?? [];
  const commandReady = canSendRemoteCommand(snapshot);
  if (permissions.length === 0) return `<p class="muted">No pending permission requests.</p>`;
  return permissions.map((permission) => `
    <article class="permission-card">
      <strong>${escapeHtml(permission.toolName)}</strong>
      <span>${escapeHtml(permission.summary)}</span>
      <small>${escapeHtml(permission.engine)} · ${escapeHtml(permission.risk)}${permission.cwd ? ` · ${escapeHtml(permission.cwd)}` : ""}</small>
      <pre>${escapeHtml(permission.rawPreview)}</pre>
      <div class="permission-actions">
        ${permission.allowedActions.map((action) => action.kind === "answer" ? `
          <textarea
            data-answer-input="${permission.requestId}:${action.optionId}"
            rows="3"
            placeholder='{"question-id":["answer"]}'
          ></textarea>
          <button
            data-permission="${permission.requestId}"
            data-session="${permission.sessionId}"
            data-action="answer"
            data-option-id="${action.optionId}"
            ${commandReady ? "" : "disabled"}
          >${escapeHtml(action.label)}</button>
        ` : `
          <button
            data-permission="${permission.requestId}"
            data-session="${permission.sessionId}"
            data-action="${action.kind}"
            ${commandReady ? "" : "disabled"}
          >${escapeHtml(action.label)}</button>
        `).join("")}
      </div>
    </article>
  `).join("");
}

function renderTerminals(snapshot: RemoteSnapshot | null): string {
  const terminals = snapshot?.terminals ?? [];
  const commandReady = canSendRemoteCommand(snapshot);
  if (terminals.length === 0) return `<p class="muted">No active terminals.</p>`;
  return terminals.map((terminal) => {
    const item = terminal as { terminalId?: string; spaceId?: string; exited?: boolean };
    if (!item.terminalId) return "";
    return `
      <button class="terminal-item" data-terminal="${item.terminalId}" ${commandReady ? "" : "disabled"}>
        <span>${escapeHtml(item.terminalId.slice(0, 8))}</span>
        <small>${escapeHtml(item.spaceId ?? "unknown")}${item.exited ? " · exited" : ""}</small>
      </button>
    `;
  }).join("");
}

function bind(): void {
  qs<HTMLFormElement>("#login-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formElement = qs<HTMLFormElement>("#login-form");
    if (!formElement) return;
    const form = new FormData(formElement);
    void login(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
  });

  qs<HTMLButtonElement>("#refresh")?.addEventListener("click", () => {
    void loadMe().then(render);
  });

  qs<HTMLInputElement>("#session-search")?.addEventListener("input", (event) => {
    state.sessionQuery = (event.target as HTMLInputElement).value;
    render();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sessionFilter = button.dataset.filter as SessionFilter;
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-session-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const sessionId = button.dataset.sessionId;
      if (!sessionId) return;
      state.selectedSessionId = sessionId;
      if (canSendRemoteCommand()) void loadMessages(sessionId, true);
      render();
    });
  });

  qs<HTMLButtonElement>("#refresh-messages")?.addEventListener("click", () => {
    if (state.selectedSessionId && canSendRemoteCommand()) void loadMessages(state.selectedSessionId, true);
  });

  qs<HTMLButtonElement>("#load-more-messages")?.addEventListener("click", () => {
    if (state.selectedSessionId && canSendRemoteCommand()) void loadMessages(state.selectedSessionId, false);
  });

  qs<HTMLFormElement>("#send-chat-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const textarea = qs<HTMLTextAreaElement>("#chat-text");
    const text = textarea?.value.trim();
    if (!text || !state.selectedSessionId || !canSendRemoteCommand()) return;
    if (textarea) textarea.value = "";
    void sendCommand("chat.send", { sessionId: state.selectedSessionId, text }, false, {
      sessionId: state.selectedSessionId,
    });
  });

  qs<HTMLButtonElement>("#diff-summary")?.addEventListener("click", () => {
    const projectId = selectedSession()?.projectId ?? state.snapshot?.projects[0]?.id;
    if (!projectId || !canSendRemoteCommand()) return;
    void sendCommand("diff.summary", { path: { projectId } });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-permission]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!canSendRemoteCommand()) return;
      const actionKind = button.dataset.action as RemotePermissionAction["kind"] | undefined;
      if (!actionKind) return;
      const label = button.textContent ?? "";
      let action: RemotePermissionAction;
      if (actionKind === "answer") {
        const optionId = button.dataset.optionId;
        if (!optionId || !button.dataset.permission) return;
        const rawAnswers = qs<HTMLTextAreaElement>(`[data-answer-input="${button.dataset.permission}:${optionId}"]`)?.value.trim();
        let answers: Record<string, string[]> | undefined;
        if (rawAnswers) {
          try {
            answers = JSON.parse(rawAnswers) as Record<string, string[]>;
          } catch {
            state.commandStatus = "Answer JSON is invalid";
            render();
            return;
          }
        }
        action = { kind: "answer", optionId, label, answers };
      } else {
        action = { kind: actionKind, label } as RemotePermissionAction;
      }
      void sendCommand("permission.respond", {
        sessionId: button.dataset.session,
        requestId: button.dataset.permission,
        action,
      }, true);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-terminal]").forEach((button) => {
    button.addEventListener("click", () => {
      const terminalId = button.dataset.terminal;
      if (!terminalId || !canSendRemoteCommand()) return;
      void sendCommand("terminal.snapshot", { terminalId });
    });
  });
}

function render(): void {
  if (!app) return;
  app.innerHTML = state.user ? shell() : loginView();
  bind();
}

void loadMe().then(render);
