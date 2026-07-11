import crypto from "crypto";
import os from "os";
import path from "path";
import { promises as fs } from "fs";
import { ipcMain, type BrowserWindow } from "electron";
import type { Event, OpencodeClient, Permission } from "@opencode-ai/sdk";
import type {
  OpenCodeModelInfo,
  OpenCodePermissionReply,
  OpenCodeStartOptions,
} from "@shared/types/opencode";
import { extractErrorMessage, reportError } from "../lib/error-utils";
import { safeSend } from "../lib/safe-send";
import { log } from "../lib/logger";
import { getOpenCodeBinaryStatus, getOpenCodeVersion, resolveOpenCodeBinaryPath } from "../lib/opencode-binary";
import { startOpenCodeServer, type OpenCodeServerHandle } from "../lib/opencode-client";
import { loadOpenCodeModelCatalog } from "../lib/opencode-model-filter";

interface OpenCodeSessionState {
  internalId: string;
  opencodeSessionId: string;
  cwd: string;
  model?: string;
  client: OpencodeClient;
  server: OpenCodeServerHandle;
  eventAbort: AbortController;
  tempDir: string;
  stopping: boolean;
}

interface OpenCodeEventSubscription {
  stream: AsyncIterable<Event>;
}

const sessions = new Map<string, OpenCodeSessionState>();
const pendingStarts = new Map<string, AbortController>();

function splitModel(model: string | undefined): { providerID: string; modelID: string } | undefined {
  if (!model) return undefined;
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) return undefined;
  return { providerID: model.slice(0, separator), modelID: model.slice(separator + 1) };
}

function getEventSessionId(event: Event): string | undefined {
  const properties = event.properties;
  if ("sessionID" in properties && typeof properties.sessionID === "string") return properties.sessionID;
  if ("part" in properties && properties.part && typeof properties.part === "object" && "sessionID" in properties.part) {
    return typeof properties.part.sessionID === "string" ? properties.part.sessionID : undefined;
  }
  if ("info" in properties && properties.info && typeof properties.info === "object" && "sessionID" in properties.info) {
    return typeof properties.info.sessionID === "string" ? properties.info.sessionID : undefined;
  }
  return undefined;
}

function permissionToolName(permission: Permission): string {
  const type = permission.type.toLowerCase();
  if (type === "bash" || type === "shell") return "Bash";
  if (type === "edit" || type === "write" || type === "patch") return "Edit";
  if (type === "read") return "Read";
  if (type === "webfetch") return "WebFetch";
  return permission.title || permission.type;
}

async function getModels(
  client: OpencodeClient,
  cwd: string,
  signal?: AbortSignal,
): Promise<{ models: OpenCodeModelInfo[]; defaultModel?: string }> {
  const catalog = await loadOpenCodeModelCatalog(client, cwd, signal);
  if (catalog.models.length === 0) {
    throw new Error("OpenCode's effective configuration has no matching selectable models.");
  }
  return catalog;
}

async function destroySession(state: OpenCodeSessionState, abortNative: boolean): Promise<void> {
  if (state.stopping) return;
  state.stopping = true;
  sessions.delete(state.internalId);
  state.eventAbort.abort();
  if (abortNative) {
    await state.client.session.abort({
      path: { id: state.opencodeSessionId },
      query: { directory: state.cwd },
    }).catch(() => undefined);
  }
  await state.server.close().catch(() => undefined);
  await fs.rm(state.tempDir, { recursive: true, force: true }).catch(() => undefined);
}

async function failSession(
  state: OpenCodeSessionState,
  getMainWindow: () => BrowserWindow | null,
  error: unknown,
): Promise<void> {
  if (state.stopping) return;
  safeSend(getMainWindow, "opencode:exit", {
    _sessionId: state.internalId,
    code: state.server.process.exitCode,
    signal: state.server.process.signalCode,
    error: extractErrorMessage(error),
  });
  await destroySession(state, false);
}

async function runEventLoop(
  state: OpenCodeSessionState,
  getMainWindow: () => BrowserWindow | null,
  initialSubscription?: OpenCodeEventSubscription,
): Promise<void> {
  for (let reconnect = 0; reconnect <= 3 && !state.stopping; reconnect += 1) {
    try {
      const subscription = reconnect === 0 && initialSubscription
        ? initialSubscription
        : await state.client.event.subscribe({
            query: { directory: state.cwd },
            signal: state.eventAbort.signal,
            sseMaxRetryAttempts: 0,
          });
      for await (const event of subscription.stream) {
        if (state.stopping || state.eventAbort.signal.aborted) return;
        if (getEventSessionId(event) !== state.opencodeSessionId) continue;
        safeSend(getMainWindow, "opencode:event", { _sessionId: state.internalId, event });
        if (event.type === "permission.updated") {
          const permission = event.properties;
          safeSend(getMainWindow, "opencode:permission_request", {
            _sessionId: state.internalId,
            requestId: permission.id,
            toolName: permissionToolName(permission),
            toolInput: permission.metadata,
            toolUseId: permission.callID,
            title: permission.title,
          });
        }
      }
      if (!state.stopping) throw new Error("OpenCode event stream ended unexpectedly");
      return;
    } catch (error) {
      if (state.stopping || state.eventAbort.signal.aborted) return;
      if (reconnect >= 3) {
        await failSession(state, getMainWindow, new Error(`OpenCode event stream reconnect exhausted: ${extractErrorMessage(error)}`));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** reconnect));
    }
  }
}

async function startSession(
  options: OpenCodeStartOptions,
  getMainWindow: () => BrowserWindow | null,
): Promise<{
  sessionId: string;
  opencodeSessionId: string;
  models: OpenCodeModelInfo[];
  selectedModel?: string;
}> {
  const internalId = crypto.randomUUID();
  const startAbort = new AbortController();
  pendingStarts.set(internalId, startAbort);
  let server: OpenCodeServerHandle | null = null;
  let tempDir: string | null = null;
  try {
    server = await startOpenCodeServer({
      binaryPath: resolveOpenCodeBinaryPath(),
      cwd: options.cwd,
      signal: startAbort.signal,
    });
    const { models, defaultModel } = await getModels(server.client, options.cwd, startAbort.signal);
    if (startAbort.signal.aborted) throw new DOMException("OpenCode start canceled", "AbortError");
    const selectedModel = options.model && models.some((model) => model.id === options.model)
      ? options.model
      : defaultModel ?? models[0]?.id;

    let opencodeSessionId: string;
    if (options.resumeSessionId) {
      const existing = unwrapResult(await server.client.session.get({
        path: { id: options.resumeSessionId },
        query: { directory: options.cwd },
        signal: startAbort.signal,
      }), "OpenCode resume");
      opencodeSessionId = existing.id;
    } else {
      const created = unwrapResult(await server.client.session.create({
        query: { directory: options.cwd },
        body: { title: "Harnss session" },
        signal: startAbort.signal,
      }), "OpenCode session create");
      opencodeSessionId = created.id;
    }

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harnss-opencode-"));
    const state: OpenCodeSessionState = {
      internalId,
      opencodeSessionId,
      cwd: options.cwd,
      model: selectedModel,
      client: server.client,
      server,
      eventAbort: new AbortController(),
      tempDir,
      stopping: false,
    };
    const initialSubscription = await state.client.event.subscribe({
      query: { directory: state.cwd },
      signal: state.eventAbort.signal,
      sseMaxRetryAttempts: 0,
    });
    sessions.set(internalId, state);
    server.process.once("exit", (code, signal) => {
      if (state.stopping) return;
      safeSend(getMainWindow, "opencode:exit", { _sessionId: internalId, code, signal });
      state.eventAbort.abort();
      sessions.delete(internalId);
      void fs.rm(state.tempDir, { recursive: true, force: true });
    });
    void runEventLoop(state, getMainWindow, initialSubscription);
    return { sessionId: internalId, opencodeSessionId, models, selectedModel };
  } catch (error) {
    if (server) await server.close().catch(() => undefined);
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  } finally {
    pendingStarts.delete(internalId);
  }
}

export function register(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("opencode:start", async (_, options: OpenCodeStartOptions) => {
    try {
      return await startSession(options, getMainWindow);
    } catch (error) {
      return { error: reportError("OPENCODE_START_ERR", error, { cwd: options.cwd }) };
    }
  });

  ipcMain.handle("opencode:resume", async (_, options: OpenCodeStartOptions & { resumeSessionId: string }) => {
    try {
      if (!options.resumeSessionId) return { error: "OpenCode session cannot resume without a native session ID." };
      return await startSession(options, getMainWindow);
    } catch (error) {
      return { error: reportError("OPENCODE_RESUME_ERR", error, { cwd: options.cwd }) };
    }
  });

  ipcMain.handle("opencode:abort-pending-start", async () => {
    for (const controller of pendingStarts.values()) controller.abort();
    pendingStarts.clear();
    return { ok: true };
  });

  ipcMain.handle("opencode:send", async (_, data: { sessionId: string; text: string; images?: unknown[] }) => {
    const state = sessions.get(data.sessionId);
    if (!state) return { error: "OpenCode session not found" };
    if (data.images?.length) {
      return { error: "OpenCode image attachments are not supported by the installed provider. Send text or a file path instead." };
    }
    try {
      await state.client.session.promptAsync({
        path: { id: state.opencodeSessionId },
        query: { directory: state.cwd },
        body: {
          ...(splitModel(state.model) ? { model: splitModel(state.model) } : {}),
          parts: [{ type: "text", text: data.text }],
        },
        throwOnError: true,
      });
      return { ok: true };
    } catch (error) {
      return { error: reportError("OPENCODE_SEND_ERR", error, { sessionId: data.sessionId }) };
    }
  });

  ipcMain.handle("opencode:interrupt", async (_, sessionId: string) => {
    const state = sessions.get(sessionId);
    if (!state) return { error: "OpenCode session not found" };
    try {
      await state.client.session.abort({
        path: { id: state.opencodeSessionId },
        query: { directory: state.cwd },
        throwOnError: true,
      });
      return { ok: true };
    } catch (error) {
      return { error: reportError("OPENCODE_INTERRUPT_ERR", error, { sessionId }) };
    }
  });

  ipcMain.handle("opencode:stop", async (_, sessionId: string) => {
    const state = sessions.get(sessionId);
    if (state) await destroySession(state, true);
    return { ok: true };
  });

  ipcMain.handle("opencode:set-model", async (_, data: { sessionId: string; model: string }) => {
    const state = sessions.get(data.sessionId);
    if (!state) return { error: "OpenCode session not found" };
    if (!splitModel(data.model)) return { error: "OpenCode model must use provider/model format" };
    state.model = data.model;
    return { ok: true };
  });

  ipcMain.handle("opencode:respond-permission", async (_, data: {
    sessionId: string;
    requestId: string;
    reply: OpenCodePermissionReply;
  }) => {
    const state = sessions.get(data.sessionId);
    if (!state) return { error: "OpenCode session not found" };
    try {
      await state.client.postSessionIdPermissionsPermissionId({
        path: { id: state.opencodeSessionId, permissionID: data.requestId },
        query: { directory: state.cwd },
        body: { response: data.reply },
        throwOnError: true,
      });
      return { ok: true };
    } catch (error) {
      return { error: reportError("OPENCODE_PERMISSION_ERR", error, { sessionId: data.sessionId }) };
    }
  });

  ipcMain.handle("opencode:list-models", async (_, cwd: string) => {
    const abort = new AbortController();
    let server: OpenCodeServerHandle | null = null;
    try {
      server = await startOpenCodeServer({ binaryPath: resolveOpenCodeBinaryPath(), cwd, signal: abort.signal });
      return await getModels(server.client, cwd);
    } catch (error) {
      return { models: [], error: reportError("OPENCODE_MODELS_ERR", error, { cwd }) };
    } finally {
      abort.abort();
      if (server) await server.close().catch(() => undefined);
    }
  });

  ipcMain.handle("opencode:binary-status", () => getOpenCodeBinaryStatus());
  ipcMain.handle("opencode:version", () => ({ version: getOpenCodeVersion() ?? undefined }));
}

export function stopAll(): void {
  for (const controller of pendingStarts.values()) controller.abort();
  pendingStarts.clear();
  for (const state of sessions.values()) void destroySession(state, true);
}

export function getOpenCodeSessionModel(sessionId: string): string | undefined {
  return sessions.get(sessionId)?.model;
}
