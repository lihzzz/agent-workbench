import type { OpenCodeSessionEvent } from "@/types";
import { reduceOpenCodeEvent } from "@/lib/engine/opencode-adapter";
import type { InternalState } from "./session-store";

export function handleOpenCodeEvent(
  state: InternalState,
  event: OpenCodeSessionEvent,
): { processingChanged?: boolean; isProcessing?: boolean } | undefined {
  const next = reduceOpenCodeEvent({
    messages: state.messages,
    isProcessing: state.isProcessing,
    isConnected: state.isConnected,
    totalCost: state.totalCost,
    contextUsage: state.contextUsage,
    modelUsage: state.modelUsage,
    currentModel: state.openCodeCurrentModel,
    contextWindow: state.contextUsage?.contextWindow,
    processedStepIds: state.openCodeProcessedStepIds ?? new Set(),
  }, event.event);

  state.messages = next.messages;
  state.isProcessing = next.isProcessing;
  state.isConnected = next.isConnected;
  state.totalCost = next.totalCost;
  state.contextUsage = next.contextUsage;
  state.modelUsage = next.modelUsage;
  state.openCodeCurrentModel = next.currentModel;
  state.openCodeProcessedStepIds = next.processedStepIds;

  return next.processingChanged === undefined
    ? undefined
    : { processingChanged: true, isProcessing: next.isProcessing };
}
