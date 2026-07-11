import type { ModelUsageEntry } from "@/types";

/** Cumulative per-model usage for a session, keyed by model name. */
export type SessionModelUsage = Record<string, ModelUsageEntry>;

/**
 * Merge a turn's `modelUsage` (from a Claude `result` event) into a running
 * cumulative total. Additive fields (tokens, cost, web searches) are summed;
 * snapshot fields (contextWindow, maxOutputTokens) take the latest non-zero value.
 *
 * Pure: returns a new object, never mutates `prev`.
 */
export function mergeModelUsage(
  prev: SessionModelUsage,
  turn: Record<string, ModelUsageEntry>,
): SessionModelUsage {
  const next: SessionModelUsage = { ...prev };
  for (const [model, entry] of Object.entries(turn)) {
    const existing = next[model];
    if (!existing) {
      next[model] = { ...entry };
      continue;
    }
    next[model] = {
      inputTokens: existing.inputTokens + entry.inputTokens,
      outputTokens: existing.outputTokens + entry.outputTokens,
      cacheReadInputTokens: existing.cacheReadInputTokens + entry.cacheReadInputTokens,
      cacheCreationInputTokens: existing.cacheCreationInputTokens + entry.cacheCreationInputTokens,
      webSearchRequests: existing.webSearchRequests + entry.webSearchRequests,
      costUSD: existing.costUSD + entry.costUSD,
      contextWindow: entry.contextWindow || existing.contextWindow,
      maxOutputTokens: entry.maxOutputTokens ?? existing.maxOutputTokens,
    };
  }
  return next;
}

/** Total cost across all models in a usage map. */
export function totalModelCost(usage: SessionModelUsage): number {
  return Object.values(usage).reduce((sum, e) => sum + (e.costUSD || 0), 0);
}
