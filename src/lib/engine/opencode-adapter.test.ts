import { describe, expect, it } from "vitest";
import type { Event } from "@opencode-ai/sdk";
import {
  openCodePermissionReply,
  reduceOpenCodeEvent,
  type OpenCodeAdapterState,
} from "./opencode-adapter";

function initialState(): OpenCodeAdapterState {
  return {
    messages: [],
    isProcessing: false,
    isConnected: false,
    totalCost: 0,
    contextUsage: null,
    modelUsage: {},
    currentModel: "openai/gpt-5",
    contextWindow: 128_000,
    processedStepIds: new Set(),
  };
}

function event(value: unknown): Event {
  return value as Event;
}

describe("OpenCode adapter", () => {
  it("replaces cumulative text snapshots by message and part ID", () => {
    const partial = reduceOpenCodeEvent(initialState(), event({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          sessionID: "native-1",
          messageID: "message-1",
          type: "text",
          text: "Hel",
        },
      },
    }));
    const complete = reduceOpenCodeEvent(partial, event({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          sessionID: "native-1",
          messageID: "message-1",
          type: "text",
          text: "Hello",
          time: { start: 1, end: 2 },
        },
      },
    }));

    expect(complete.messages).toHaveLength(1);
    expect(complete.messages[0]).toMatchObject({ content: "Hello", isStreaming: false });
  });

  it("updates a single mapped tool card from running to completed", () => {
    const running = reduceOpenCodeEvent(initialState(), event({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-part",
          sessionID: "native-1",
          messageID: "message-1",
          type: "tool",
          callID: "call-1",
          tool: "bash",
          state: { status: "running", input: { command: "pwd" }, time: { start: 1 } },
        },
      },
    }));
    const completed = reduceOpenCodeEvent(running, event({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-part",
          sessionID: "native-1",
          messageID: "message-1",
          type: "tool",
          callID: "call-1",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "pwd" },
            output: "/repo",
            title: "pwd",
            metadata: {},
            time: { start: 1, end: 2 },
          },
        },
      },
    }));

    expect(completed.messages).toHaveLength(1);
    expect(completed.messages[0]).toMatchObject({
      id: "opencode-tool-call-1",
      toolName: "Bash",
      toolInput: { command: "pwd" },
      toolResult: { stdout: "/repo" },
    });
  });

  it("records step usage once when an SSE snapshot is repeated", () => {
    const stepEvent = event({
      type: "message.part.updated",
      properties: {
        part: {
          id: "step-1",
          sessionID: "native-1",
          messageID: "message-1",
          type: "step-finish",
          reason: "stop",
          cost: 0.25,
          tokens: {
            input: 100,
            output: 20,
            reasoning: 5,
            cache: { read: 10, write: 2 },
          },
        },
      },
    });

    const once = reduceOpenCodeEvent(initialState(), stepEvent);
    const twice = reduceOpenCodeEvent(once, stepEvent);

    expect(twice.totalCost).toBe(0.25);
    expect(twice.contextUsage).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 10,
      cacheCreationTokens: 2,
      contextWindow: 128_000,
    });
    expect(twice.modelUsage["openai/gpt-5"].costUSD).toBe(0.25);
  });

  it("maps permission actions to the OpenCode reply contract", () => {
    expect(openCodePermissionReply("allow")).toBe("once");
    expect(openCodePermissionReply("allowForSession")).toBe("always");
    expect(openCodePermissionReply("deny")).toBe("reject");
  });
});
