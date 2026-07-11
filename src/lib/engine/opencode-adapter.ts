import type { Event as OpenCodeEvent, Part as OpenCodePart, ToolPart } from "@opencode-ai/sdk";
import type { AppPermissionBehavior, ContextUsage, ModelUsageEntry, OpenCodePermissionReply, UIMessage } from "@/types";
import type { SessionModelUsage } from "@/lib/session/model-usage";
import { mergeModelUsage } from "@/lib/session/model-usage";
import { normalizeToolInput, normalizeToolResult } from "./acp-adapter";

const DEFAULT_CONTEXT_WINDOW = 200_000;

export interface OpenCodeAdapterState {
  messages: UIMessage[];
  isProcessing: boolean;
  isConnected: boolean;
  totalCost: number;
  contextUsage: ContextUsage | null;
  modelUsage: SessionModelUsage;
  currentModel?: string;
  contextWindow?: number;
  processedStepIds: Set<string>;
}

export interface OpenCodeAdapterResult extends OpenCodeAdapterState {
  processingChanged?: boolean;
}

const TOOL_NAMES: Record<string, string> = {
  bash: "Bash",
  edit: "Edit",
  write: "Write",
  read: "Read",
  grep: "Grep",
  glob: "Glob",
  list: "LS",
  ls: "LS",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  todowrite: "TodoWrite",
  todoread: "TodoRead",
  task: "Task",
  patch: "Edit",
};

export function openCodeToolName(name: string): string {
  return TOOL_NAMES[name.toLowerCase()] ?? name;
}

export function openCodePermissionReply(behavior: AppPermissionBehavior): OpenCodePermissionReply {
  if (behavior === "allow") return "once";
  if (behavior === "allowForSession") return "always";
  return "reject";
}

function toolKind(name: string): string | undefined {
  switch (name.toLowerCase()) {
    case "read": return "read";
    case "edit":
    case "write":
    case "patch": return "edit";
    case "grep":
    case "glob":
    case "list":
    case "ls": return "search";
    case "webfetch":
    case "websearch": return "fetch";
    case "task": return "execute";
    default: return undefined;
  }
}

function normalizeInput(part: ToolPart): Record<string, unknown> {
  const input = normalizeToolInput(part.state.input, toolKind(part.tool));
  const raw = part.state.input;
  if (typeof raw.filePath === "string" && typeof input.file_path !== "string") {
    input.file_path = raw.filePath;
  }
  if (typeof raw.oldString === "string" && typeof input.old_string !== "string") {
    input.old_string = raw.oldString;
  }
  if (typeof raw.newString === "string" && typeof input.new_string !== "string") {
    input.new_string = raw.newString;
  }
  return input;
}

function upsertMessage(messages: UIMessage[], message: UIMessage): UIMessage[] {
  const index = messages.findIndex((entry) => entry.id === message.id);
  if (index < 0) return [...messages, message];
  const next = [...messages];
  next[index] = { ...messages[index], ...message };
  return next;
}

function partMessageId(part: OpenCodePart): string {
  return `opencode-${part.messageID}-${part.id}`;
}

function toolResult(part: ToolPart): Record<string, unknown> | undefined {
  if (part.state.status === "completed") {
    return normalizeToolResult(part.state.output) ?? { status: "completed" };
  }
  if (part.state.status === "error") {
    return normalizeToolResult(part.state.error) ?? { error: part.state.error };
  }
  return undefined;
}

function applyPart(state: OpenCodeAdapterResult, part: OpenCodePart, delta?: string): void {
  const timestamp = "time" in part && part.time && "start" in part.time
    ? part.time.start
    : Date.now();

  switch (part.type) {
    case "text": {
      const id = partMessageId(part);
      const existing = state.messages.find((message) => message.id === id);
      const content = part.text || (existing?.content ?? "") + (delta ?? "");
      state.messages = upsertMessage(state.messages, {
        id,
        role: "assistant",
        content,
        isStreaming: part.time?.end === undefined,
        timestamp,
      });
      break;
    }
    case "reasoning": {
      const id = partMessageId(part);
      const existing = state.messages.find((message) => message.id === id);
      const thinking = part.text || (existing?.thinking ?? "") + (delta ?? "");
      state.messages = upsertMessage(state.messages, {
        id,
        role: "assistant",
        content: "",
        thinking,
        thinkingComplete: part.time.end !== undefined,
        isStreaming: part.time.end === undefined,
        timestamp,
      });
      break;
    }
    case "tool": {
      const id = `opencode-tool-${part.callID}`;
      const result = toolResult(part);
      state.messages = upsertMessage(state.messages, {
        id,
        role: "tool_call",
        content: "",
        toolName: openCodeToolName(part.tool),
        toolInput: normalizeInput(part),
        ...(result ? { toolResult: result } : {}),
        ...(part.state.status === "error" ? { toolError: true } : {}),
        timestamp,
      });
      break;
    }
    case "file": {
      const filePath = part.source?.path ?? part.filename ?? part.url;
      state.messages = upsertMessage(state.messages, {
        id: partMessageId(part),
        role: "tool_call",
        content: "",
        toolName: "Read",
        toolInput: { file_path: filePath },
        toolResult: { stdout: part.url, filePath },
        timestamp,
      });
      break;
    }
    case "patch": {
      state.messages = upsertMessage(state.messages, {
        id: partMessageId(part),
        role: "tool_call",
        content: "",
        toolName: "Edit",
        toolInput: { file_path: part.files[0] ?? "", files: part.files, hash: part.hash },
        toolResult: { stdout: part.files.join("\n"), filePath: part.files[0] },
        timestamp,
      });
      break;
    }
    case "step-start": {
      const wasProcessing = state.isProcessing;
      state.isProcessing = true;
      state.processingChanged = !wasProcessing;
      break;
    }
    case "step-finish": {
      if (!state.processedStepIds.has(part.id)) {
        state.processedStepIds.add(part.id);
        const contextWindow = state.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
        state.contextUsage = {
          inputTokens: part.tokens.input,
          outputTokens: part.tokens.output,
          cacheReadTokens: part.tokens.cache.read,
          cacheCreationTokens: part.tokens.cache.write,
          contextWindow,
        };
        state.totalCost += part.cost;
        const model = state.currentModel ?? "opencode";
        const usage: ModelUsageEntry = {
          inputTokens: part.tokens.input,
          outputTokens: part.tokens.output,
          cacheReadInputTokens: part.tokens.cache.read,
          cacheCreationInputTokens: part.tokens.cache.write,
          webSearchRequests: 0,
          costUSD: part.cost,
          contextWindow,
        };
        state.modelUsage = mergeModelUsage(state.modelUsage, { [model]: usage });
      }
      state.messages = state.messages.map((message) =>
        message.id.startsWith(`opencode-${part.messageID}-`) && message.isStreaming
          ? { ...message, isStreaming: false, ...(message.thinking ? { thinkingComplete: true } : {}) }
          : message,
      );
      break;
    }
    default:
      break;
  }
}

function eventErrorText(error: unknown): string {
  if (!error) return "OpenCode session failed.";
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (record.data && typeof record.data === "object") {
      const data = record.data as Record<string, unknown>;
      if (typeof data.message === "string") return data.message;
    }
  }
  return "OpenCode session failed.";
}

/** Project one native OpenCode event into the shared Harnss chat state. */
export function reduceOpenCodeEvent(
  current: OpenCodeAdapterState,
  event: OpenCodeEvent,
): OpenCodeAdapterResult {
  const next: OpenCodeAdapterResult = {
    ...current,
    messages: current.messages,
    modelUsage: current.modelUsage,
    processedStepIds: current.processedStepIds,
  };
  next.isConnected = true;

  switch (event.type) {
    case "message.updated": {
      const info = event.properties.info;
      if (info.role === "assistant") {
        next.currentModel = `${info.providerID}/${info.modelID}`;
      }
      break;
    }
    case "message.part.updated":
      applyPart(next, event.properties.part, event.properties.delta);
      break;
    case "session.status": {
      const processing = event.properties.status.type !== "idle";
      next.processingChanged = processing !== current.isProcessing;
      next.isProcessing = processing;
      break;
    }
    case "session.idle": {
      next.processingChanged = current.isProcessing;
      next.isProcessing = false;
      next.messages = next.messages.map((message) =>
        message.isStreaming
          ? { ...message, isStreaming: false, ...(message.thinking ? { thinkingComplete: true } : {}) }
          : message,
      );
      break;
    }
    case "session.error": {
      next.processingChanged = current.isProcessing;
      next.isProcessing = false;
      next.messages = [
        ...next.messages,
        {
          id: `opencode-error-${Date.now()}`,
          role: "system",
          content: eventErrorText(event.properties.error),
          timestamp: Date.now(),
          isError: true,
        },
      ];
      break;
    }
    default:
      break;
  }

  return next;
}
