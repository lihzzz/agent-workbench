import { describe, it, expect } from "vitest";
import {
  aggregateUsage,
  bucketStartFor,
  filterRowsSince,
  isOverBudget,
  type UsageRow,
} from "./usage-aggregation";
import type { EngineId } from "@/types";

function row(partial: Partial<UsageRow> & { sessionId: string }): UsageRow {
  const ts = partial.lastMessageAt ?? partial.createdAt ?? Date.parse("2026-06-15T12:00:00Z");
  return {
    projectId: partial.projectId ?? "p1",
    projectName: partial.projectName ?? "Project 1",
    sessionId: partial.sessionId,
    title: partial.title ?? "Session",
    engine: (partial.engine ?? "claude") as EngineId,
    createdAt: partial.createdAt ?? ts,
    lastMessageAt: ts,
    totalCost: partial.totalCost ?? 0,
    modelUsage: partial.modelUsage ?? {},
  };
}

describe("bucketStartFor", () => {
  it("buckets by UTC day", () => {
    const ms = Date.parse("2026-06-15T18:30:00Z");
    expect(bucketStartFor(ms, "day")).toBe(Date.UTC(2026, 5, 15));
  });

  it("buckets by ISO week (Monday)", () => {
    // 2026-06-15 is a Monday
    const monday = Date.parse("2026-06-15T18:30:00Z");
    const wednesday = Date.parse("2026-06-17T03:00:00Z");
    expect(bucketStartFor(monday, "week")).toBe(bucketStartFor(wednesday, "week"));
    expect(bucketStartFor(monday, "week")).toBe(Date.UTC(2026, 5, 15));
  });

  it("buckets by month", () => {
    const ms = Date.parse("2026-06-28T10:00:00Z");
    expect(bucketStartFor(ms, "month")).toBe(Date.UTC(2026, 5, 1));
  });
});

describe("aggregateUsage", () => {
  it("sums total cost and session count", () => {
    const rows = [
      row({ sessionId: "a", totalCost: 1 }),
      row({ sessionId: "b", totalCost: 2.5 }),
    ];
    const summary = aggregateUsage(rows, "day");
    expect(summary.totalCost).toBeCloseTo(3.5);
    expect(summary.sessionCount).toBe(2);
  });

  it("groups by project, sorted by cost desc", () => {
    const rows = [
      row({ sessionId: "a", projectId: "p1", projectName: "One", totalCost: 1 }),
      row({ sessionId: "b", projectId: "p2", projectName: "Two", totalCost: 5 }),
      row({ sessionId: "c", projectId: "p1", projectName: "One", totalCost: 2 }),
    ];
    const summary = aggregateUsage(rows, "day");
    expect(summary.byProject).toHaveLength(2);
    expect(summary.byProject[0]).toMatchObject({ projectId: "p2", cost: 5, count: 1 });
    expect(summary.byProject[1]).toMatchObject({ projectId: "p1", cost: 3, count: 2 });
  });

  it("groups by engine", () => {
    const rows = [
      row({ sessionId: "a", engine: "claude", totalCost: 1 }),
      row({ sessionId: "b", engine: "codex", totalCost: 2 }),
      row({ sessionId: "c", engine: "claude", totalCost: 3 }),
    ];
    const summary = aggregateUsage(rows, "day");
    const claude = summary.byEngine.find((e) => e.engine === "claude");
    const codex = summary.byEngine.find((e) => e.engine === "codex");
    expect(claude).toMatchObject({ cost: 4, count: 2 });
    expect(codex).toMatchObject({ cost: 2, count: 1 });
  });

  it("buckets by day and sorts chronologically", () => {
    const rows = [
      row({ sessionId: "a", lastMessageAt: Date.parse("2026-06-15T01:00:00Z"), totalCost: 1 }),
      row({ sessionId: "b", lastMessageAt: Date.parse("2026-06-15T23:00:00Z"), totalCost: 1 }),
      row({ sessionId: "c", lastMessageAt: Date.parse("2026-06-14T10:00:00Z"), totalCost: 2 }),
    ];
    const summary = aggregateUsage(rows, "day");
    expect(summary.byBucket).toHaveLength(2);
    expect(summary.byBucket[0].bucketStart).toBe(Date.UTC(2026, 5, 14));
    expect(summary.byBucket[0].cost).toBe(2);
    expect(summary.byBucket[1].bucketStart).toBe(Date.UTC(2026, 5, 15));
    expect(summary.byBucket[1].cost).toBe(2);
    expect(summary.byBucket[1].count).toBe(2);
  });

  it("returns top sessions by cost limited to topN", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ sessionId: `s${i}`, totalCost: i }),
    );
    const summary = aggregateUsage(rows, "day", 2);
    expect(summary.topSessions).toHaveLength(2);
    expect(summary.topSessions[0].totalCost).toBe(4);
    expect(summary.topSessions[1].totalCost).toBe(3);
  });

  it("handles empty input", () => {
    const summary = aggregateUsage([], "day");
    expect(summary.totalCost).toBe(0);
    expect(summary.sessionCount).toBe(0);
    expect(summary.byProject).toEqual([]);
    expect(summary.byBucket).toEqual([]);
    expect(summary.byModel).toEqual([]);
    expect(summary.topSessions).toEqual([]);
  });

  it("aggregates per-model usage across sessions, sorted by cost", () => {
    const mk = (cost: number, input: number) => ({
      costUSD: cost,
      inputTokens: input,
      outputTokens: 10,
      cacheReadInputTokens: 5,
      cacheCreationInputTokens: 1,
      webSearchRequests: 0,
      contextWindow: 200_000,
    });
    const rows = [
      row({ sessionId: "a", modelUsage: { "claude-opus-4": mk(2, 100) } }),
      row({ sessionId: "b", modelUsage: { "claude-opus-4": mk(3, 50), "claude-haiku": mk(1, 20) } }),
    ];
    const summary = aggregateUsage(rows, "day");
    expect(summary.byModel).toHaveLength(2);
    expect(summary.byModel[0]).toMatchObject({ model: "claude-opus-4", cost: 5, inputTokens: 150 });
    expect(summary.byModel[1]).toMatchObject({ model: "claude-haiku", cost: 1, inputTokens: 20 });
  });
});

describe("filterRowsSince", () => {
  it("returns all rows when since is null", () => {
    const rows = [row({ sessionId: "a" })];
    expect(filterRowsSince(rows, null)).toEqual(rows);
  });

  it("filters out rows older than the cutoff", () => {
    const rows = [
      row({ sessionId: "old", lastMessageAt: Date.parse("2026-05-01T00:00:00Z") }),
      row({ sessionId: "new", lastMessageAt: Date.parse("2026-06-10T00:00:00Z") }),
    ];
    const cutoff = Date.parse("2026-06-01T00:00:00Z");
    const result = filterRowsSince(rows, cutoff);
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("new");
  });
});

describe("isOverBudget", () => {
  it("returns false when no budget is set", () => {
    expect(isOverBudget(1000, null)).toBe(false);
    expect(isOverBudget(1000, 0)).toBe(false);
  });

  it("returns true only when spend exceeds budget", () => {
    expect(isOverBudget(50, 100)).toBe(false);
    expect(isOverBudget(150, 100)).toBe(true);
  });
});
