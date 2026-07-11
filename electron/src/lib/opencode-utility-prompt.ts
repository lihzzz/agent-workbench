import type { Event, Provider } from "@opencode-ai/sdk";
import { extractErrorMessage } from "./error-utils";
import { resolveOpenCodeBinaryPath } from "./opencode-binary";
import { startOpenCodeServer, type OpenCodeServerHandle } from "./opencode-client";
import { loadFilteredOpenCodeModels } from "./opencode-model-filter";

function unwrap<T>(result: { data?: T; error?: unknown }, label: string): T {
  if (result.error !== undefined) throw new Error(`${label}: ${extractErrorMessage(result.error)}`);
  if (result.data === undefined) throw new Error(`${label}: empty response`);
  return result.data;
}

function splitModel(model: string): { providerID: string; modelID: string } | undefined {
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) return undefined;
  return { providerID: model.slice(0, separator), modelID: model.slice(separator + 1) };
}

function eventSessionId(event: Event): string | undefined {
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

export async function openCodeUtilityPrompt(
  prompt: string,
  cwd: string,
  options?: { timeoutMs?: number; model?: string },
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? 60_000;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error(`OpenCode utility prompt timed out after ${timeoutMs}ms`)), timeoutMs);
  let server: OpenCodeServerHandle | null = null;

  try {
    server = await startOpenCodeServer({
      binaryPath: resolveOpenCodeBinaryPath(),
      cwd,
      signal: abort.signal,
    });
    const providerData = unwrap(await server.client.config.providers({ query: { directory: cwd } }), "OpenCode providers");
    const models = await loadFilteredOpenCodeModels(cwd, providerData.providers as Provider[]);
    if (models.length === 0) throw new Error("OpenCode has no configured provider models");
    const selected = options?.model && models.some((model) => model.id === options.model)
      ? options.model
      : models[0].id;
    const nativeModel = splitModel(selected);
    if (!nativeModel) throw new Error(`Invalid OpenCode model ID: ${selected}`);

    const created = unwrap(await server.client.session.create({
      query: { directory: cwd },
      body: { title: "Harnss utility prompt" },
    }), "OpenCode utility session create");
    const subscription = await server.client.event.subscribe({
      query: { directory: cwd },
      signal: abort.signal,
      sseMaxRetryAttempts: 0,
    });
    const assistantMessageIds = new Set<string>();
    const textParts = new Map<string, string>();
    const collect = (async () => {
      for await (const event of subscription.stream) {
        if (eventSessionId(event) !== created.id) continue;
        if (event.type === "message.updated" && event.properties.info.role === "assistant") {
          assistantMessageIds.add(event.properties.info.id);
          continue;
        }
        if (event.type === "message.part.updated" && event.properties.part.type === "text") {
          const part = event.properties.part;
          textParts.set(`${part.messageID}:${part.id}`, part.text);
          continue;
        }
        if (event.type === "session.error") {
          throw new Error(`OpenCode utility prompt failed: ${extractErrorMessage(event.properties.error)}`);
        }
        if (event.type === "session.idle") break;
      }
      const text = [...textParts.entries()]
        .filter(([key]) => assistantMessageIds.has(key.split(":", 1)[0]))
        .map(([, value]) => value)
        .join("\n")
        .trim();
      if (!text) throw new Error("OpenCode utility prompt returned no assistant text");
      return text;
    })();

    await server.client.session.promptAsync({
      path: { id: created.id },
      query: { directory: cwd },
      body: { model: nativeModel, parts: [{ type: "text", text: prompt }] },
      throwOnError: true,
    });
    return await collect;
  } catch (error) {
    if (abort.signal.aborted) {
      throw new Error(`OpenCode utility prompt timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    abort.abort();
    if (server) await server.close().catch(() => undefined);
  }
}
