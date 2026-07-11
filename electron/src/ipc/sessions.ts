import { ipcMain, dialog, BrowserWindow } from "electron";
import path from "path";
import fs from "fs";
import { getDataDir, getProjectSessionsDir, getSessionFilePath } from "../lib/data-dir";
import { reportError } from "../lib/error-utils";
import { log } from "../lib/logger";
import {
  getLastUserMessageTimestamp,
  extractSessionMeta,
  type SessionMeta,
} from "@shared/lib/session-persistence";
import { atomicWriteFile, KeyedFileQueue } from "../lib/atomic-write";

interface SearchResult {
  messageResults: Array<{
    sessionId: string;
    projectId: string;
    sessionTitle: string;
    messageId: string;
    snippet: string;
    timestamp: number;
  }>;
  sessionResults: Array<{
    sessionId: string;
    projectId: string;
    title: string;
    createdAt: number;
  }>;
}

function getMetaFilePath(projectId: string, sessionId: string): string {
  return getSessionFilePath(projectId, sessionId).replace(/\.json$/, ".meta.json");
}

const sessionFileQueue = new KeyedFileQueue();

export function flushSessionWrites(): Promise<void> {
  return sessionFileQueue.flush();
}

export function register(): void {
  ipcMain.handle("sessions:save", async (_event, data: { projectId: string; id: string; createdAt?: number; messages?: Array<{ role?: string; timestamp?: number }> }) => {
    try {
      const filePath = getSessionFilePath(data.projectId, data.id);

      const providedLastMessageAt = (data as Record<string, unknown>).lastMessageAt;
      const normalizedProvidedLastMessageAt =
        typeof providedLastMessageAt === "number" ? providedLastMessageAt : undefined;
      // Always prefer the latest user message timestamp when messages are present.
      const lastMessageAt =
        getLastUserMessageTimestamp(data.messages) ??
        normalizedProvidedLastMessageAt ??
        data.createdAt ??
        0;
      const enriched = { ...data, lastMessageAt };

      const wroteMain = await sessionFileQueue.run(filePath, async () => {
        // Never let a transient renderer reset replace a real transcript with an empty one.
        if (Array.isArray(data.messages) && data.messages.length === 0) {
          try {
            const existingRaw = await fs.promises.readFile(filePath, "utf-8");
            const existing = JSON.parse(existingRaw) as { messages?: unknown };
            if (Array.isArray(existing.messages) && existing.messages.length > 0) {
              log("SESSIONS", `Skipped empty-messages overwrite for ${data.id} (disk has ${existing.messages.length} messages)`);
              return false;
            }
          } catch {
            // No readable existing file; write the supplied state.
          }
        }
        await atomicWriteFile(filePath, JSON.stringify(enriched));
        return true;
      });
      if (!wroteMain) return { ok: true, skipped: "empty-messages" };

      const meta = extractSessionMeta(enriched as unknown as Record<string, unknown>, lastMessageAt);
      const metaPath = getMetaFilePath(data.projectId, data.id);
      await sessionFileQueue.run(metaPath, () => atomicWriteFile(metaPath, JSON.stringify(meta)));
      return { ok: true };
    } catch (err) {
      const message = reportError("SESSIONS:SAVE_ERR", err, { sessionId: data.id });
      return { error: message };
    }
  });

  ipcMain.handle("sessions:load", async (_event, projectId: string, sessionId: string) => {
    try {
      const filePath = getSessionFilePath(projectId, sessionId);
      try {
        await fs.promises.access(filePath);
      } catch {
        return null;
      }
      return JSON.parse(await fs.promises.readFile(filePath, "utf-8"));
    } catch (err) {
      reportError("SESSIONS:LOAD_ERR", err, { projectId, sessionId });
      return null;
    }
  });

  ipcMain.handle("sessions:list", async (_event, projectId: string) => {
    try {
      const dir = getProjectSessionsDir(projectId);
      const allFiles = await fs.promises.readdir(dir);

      // Prefer .meta.json sidecar files for fast listing
      const metaFiles = allFiles.filter((f) => f.endsWith(".meta.json"));
      const metaBasenames = new Set(metaFiles.map((f) => f.replace(/\.meta\.json$/, "")));

      // Find .json files that lack a .meta.json sidecar (migration path)
      const fullParseFiles = allFiles.filter(
        (f) => f.endsWith(".json") && !f.endsWith(".meta.json") && !metaBasenames.has(f.replace(/\.json$/, ""))
      );

      const items = await Promise.all([
        // Fast path: read small sidecar files
        ...metaFiles.map(async (file): Promise<SessionMeta | null> => {
          try {
            const raw = await fs.promises.readFile(path.join(dir, file), "utf-8");
            const data = JSON.parse(raw) as SessionMeta;
            return data;
          } catch {
            return null;
          }
        }),
        // Fallback: full-file parse for sessions without sidecar
        ...fullParseFiles.map(async (file): Promise<SessionMeta | null> => {
          try {
            const raw = await fs.promises.readFile(path.join(dir, file), "utf-8");
            const data = JSON.parse(raw) as Record<string, unknown>;
            const lastMessageAt: number =
              getLastUserMessageTimestamp(data.messages as Array<{ role?: string; timestamp?: number }>) ??
              (typeof data.lastMessageAt === "number" ? data.lastMessageAt : undefined) ??
              (data.createdAt as number) ??
              0;

            return extractSessionMeta(data, lastMessageAt);
          } catch {
            return null;
          }
        }),
      ]);

      const list: SessionMeta[] = items.filter((item): item is SessionMeta => item !== null);

      // Dedupe Codex sessions that share a codexThreadId. Reviving/resuming a Codex
      // session mints a fresh process-level session id each time, which historically
      // left multiple files for the same logical thread on disk — surfacing as
      // duplicate, identically-named sidebar entries. The thread is the stable
      // logical identity, so keep only the most recently active file per thread.
      const bestByThread = new Map<string, SessionMeta>();
      const deduped: SessionMeta[] = [];
      for (const item of list) {
        const nativeKey = item.engine === "codex" && item.codexThreadId
          ? `codex:${item.codexThreadId}`
          : item.engine === "opencode" && item.opencodeSessionId
            ? `opencode:${item.opencodeSessionId}`
            : undefined;
        if (nativeKey) {
          const existing = bestByThread.get(nativeKey);
          if (!existing) {
            bestByThread.set(nativeKey, item);
            deduped.push(item);
          } else if (item.lastMessageAt > existing.lastMessageAt) {
            // Replace the previously kept entry with this newer one.
            bestByThread.set(nativeKey, item);
            deduped[deduped.indexOf(existing)] = item;
          }
          // Otherwise this is an older duplicate of the same thread — skip it.
          continue;
        }
        deduped.push(item);
      }

      // Sort by most recent user activity, not creation time.
      deduped.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
      return deduped;
    } catch (err) {
      reportError("SESSIONS:LIST_ERR", err, { projectId });
      return [];
    }
  });

  ipcMain.handle("sessions:update-meta", async (
    _event,
    { projectId, sessionId, patch }: {
      projectId: string;
      sessionId: string;
      patch: { pinned?: boolean; folderId?: string | null; branch?: string; archived?: boolean };
    },
  ) => {
    try {
      const metaPath = getMetaFilePath(projectId, sessionId);
      await sessionFileQueue.run(metaPath, async () => {
        try {
          const metaRaw = await fs.promises.readFile(metaPath, "utf-8");
          const meta = JSON.parse(metaRaw);
          if ("pinned" in patch) meta.pinned = patch.pinned || undefined;
          if ("folderId" in patch) meta.folderId = patch.folderId || undefined;
          if ("branch" in patch) meta.branch = patch.branch || undefined;
          if ("archived" in patch) meta.archived = patch.archived || undefined;
          await atomicWriteFile(metaPath, JSON.stringify(meta));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      });

      const filePath = getSessionFilePath(projectId, sessionId);
      await sessionFileQueue.run(filePath, async () => {
        try {
          const raw = await fs.promises.readFile(filePath, "utf-8");
          const sessionData = JSON.parse(raw);
          if ("pinned" in patch) sessionData.pinned = patch.pinned || undefined;
          if ("folderId" in patch) sessionData.folderId = patch.folderId || undefined;
          if ("branch" in patch) sessionData.branch = patch.branch || undefined;
          if ("archived" in patch) sessionData.archived = patch.archived || undefined;
          await atomicWriteFile(filePath, JSON.stringify(sessionData));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      });

      return { ok: true };
    } catch (err) {
      const message = reportError("SESSIONS:UPDATE_META_ERR", err, { projectId, sessionId });
      return { error: message };
    }
  });

  ipcMain.handle("sessions:export", async (
    _event,
    args: {
      format: "markdown" | "json" | "html";
      content: string;
      defaultFileName: string;
    },
  ): Promise<{ ok?: true; filePath?: string; canceled?: true; error?: string }> => {
    try {
      const FILTERS: Record<typeof args.format, Electron.FileFilter> = {
        markdown: { name: "Markdown", extensions: ["md"] },
        json: { name: "JSON", extensions: ["json"] },
        html: { name: "HTML", extensions: ["html"] },
      };
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
      const result = win
        ? await dialog.showSaveDialog(win, {
            defaultPath: args.defaultFileName,
            filters: [FILTERS[args.format], { name: "All Files", extensions: ["*"] }],
          })
        : await dialog.showSaveDialog({
            defaultPath: args.defaultFileName,
            filters: [FILTERS[args.format], { name: "All Files", extensions: ["*"] }],
          });

      if (result.canceled || !result.filePath) return { canceled: true };

      await fs.promises.writeFile(result.filePath, args.content, "utf-8");
      return { ok: true, filePath: result.filePath };
    } catch (err) {
      const message = reportError("SESSIONS:EXPORT_ERR", err, { format: args.format });
      return { error: message };
    }
  });

  ipcMain.handle("sessions:delete", async (_event, projectId: string, sessionId: string) => {
    try {
      const filePath = getSessionFilePath(projectId, sessionId);
      const metaPath = getMetaFilePath(projectId, sessionId);

      // Delete both main file and sidecar, ignoring ENOENT
      await Promise.all([
        sessionFileQueue.run(filePath, () => fs.promises.unlink(filePath).catch((err: NodeJS.ErrnoException) => {
          if (err.code !== "ENOENT") throw err;
        })),
        sessionFileQueue.run(metaPath, () => fs.promises.unlink(metaPath).catch((err: NodeJS.ErrnoException) => {
          if (err.code !== "ENOENT") throw err;
        })),
      ]);
      return { ok: true };
    } catch (err) {
      const message = reportError("SESSIONS:DELETE_ERR", err, { projectId, sessionId });
      return { error: message };
    }
  });

  ipcMain.handle("sessions:search", async (_event, { projectIds, query }: { projectIds: string[]; query: string }): Promise<SearchResult> => {
    try {
      const lowerQuery = query.toLowerCase();
      const messageResults: SearchResult["messageResults"] = [];
      const sessionResults: SearchResult["sessionResults"] = [];

      for (const projectId of projectIds) {
        const dir = path.join(getDataDir(), "sessions", projectId);
        try {
          await fs.promises.access(dir);
        } catch {
          continue;
        }

        const allFiles = await fs.promises.readdir(dir);
        const files = allFiles.filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json"));
        for (const file of files) {
          const filePath = path.join(dir, file);
          try {
            const stat = await fs.promises.stat(filePath);
            if (stat.size > 5 * 1024 * 1024) continue;

            const raw = await fs.promises.readFile(filePath, "utf-8");
            const data = JSON.parse(raw);
            const sessionTitle = data.title || "Untitled";
            const sessionId = data.id;

            if (sessionTitle.toLowerCase().includes(lowerQuery)) {
              sessionResults.push({
                sessionId,
                projectId,
                title: sessionTitle,
                createdAt: data.createdAt || 0,
              });
            }

            if (messageResults.length >= 10) continue;
            const messages = data.messages || [];
            for (const msg of messages) {
              if (messageResults.length >= 10) break;
              if (msg.role !== "user" && msg.role !== "assistant") continue;
              if (!msg.content || typeof msg.content !== "string") continue;

              const idx = msg.content.toLowerCase().indexOf(lowerQuery);
              if (idx === -1) continue;

              const start = Math.max(0, idx - 30);
              const end = Math.min(msg.content.length, idx + query.length + 50);
              let snippet = msg.content.slice(start, end);
              if (start > 0) snippet = "..." + snippet;
              if (end < msg.content.length) snippet = snippet + "...";

              messageResults.push({
                sessionId,
                projectId,
                sessionTitle,
                messageId: msg.id,
                snippet,
                timestamp: msg.timestamp || data.createdAt || 0,
              });
            }
          } catch {
            // Skip corrupted files
          }
        }
      }

      return { messageResults, sessionResults };
    } catch (err) {
      reportError("SESSIONS:SEARCH_ERR", err, { query });
      return { messageResults: [], sessionResults: [] };
    }
  });
}
