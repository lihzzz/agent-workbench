import { describe, it, expect } from "vitest";
import { mergeModelUsage, totalModelCost, type SessionModelUsage } from "./model-usage";
import type { ModelUsageEntry } from "@/types";

function entry(partial: Partial<ModelUsageEntry>): ModelUsageEntry {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    webSearchRequests: 0,
    costUSD: 0,
    contextWindow: 0,
    ...partial,
  };
}

describe("mergeModelUsage", () => {
  it("adds a new model on first sighting", () => {
    const result = mergeModelUsage({}, { "claude-opus": entry({ inputTokens: 100, costUSD: 1 }) });
    expect(result["claude-opus"]).toMatchObject({ inputTokens: 100, costUSD: 1 });
  });

  it("sums additive fields across turns", () => {
    const prev: SessionModelUsage = {
      "claude-opus": entry({ inputTokens: 100, outputTokens: 20, costUSD: 1, webSearchRequests: 2 }),
    };
    const result = mergeModelUsage(prev, {
      "claude-opus": entry({ inputTokens: 50, outputTokens: 10, costUSD: 0.5, webSearchRequests: 3 }),
    });
    expect(result["claude-opus"]).toMatchObject({
      inputTokens: 150,
      outputTokens: 30,
      costUSD: 1.5,
      webSearchRequests: 5,
    });
  });

  it("takes the latest non-zero contextWindow", () => {
    const prev: SessionModelUsage = { m: entry({ contextWindow: 200_000 }) };
    expect(mergeModelUsage(prev, { m: entry({ contextWindow: 0 }) }).m.contextWindow).toBe(200_000);
    expect(mergeModelUsage(prev, { m: entry({ contextWindow: 1_000_000 }) }).m.contextWindow).toBe(1_000_000);
  });

  it("does not mutate the previous object", () => {
    const prev: SessionModelUsage = { m: entry({ costUSD: 1 }) };
    mergeModelUsage(prev, { m: entry({ costUSD: 2 }) });
    expect(prev.m.costUSD).toBe(1);
  });

  it("merges multiple models in one turn", () => {
    const result = mergeModelUsage({}, {
      a: entry({ costUSD: 1 }),
      b: entry({ costUSD: 2 }),
    });
    expect(Object.keys(result)).toHaveLength(2);
  });
});

describe("totalModelCost", () => {
  it("sums cost across all models", () => {
    const usage: SessionModelUsage = {
      a: entry({ costUSD: 1.5 }),
      b: entry({ costUSD: 2.25 }),
    };
    expect(totalModelCost(usage)).toBeCloseTo(3.75);
  });

  it("returns 0 for empty usage", () => {
    expect(totalModelCost({})).toBe(0);
  });
});
