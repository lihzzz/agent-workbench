import type { EngineId } from "@/types";
import type { SessionMetaModelUsage } from "@shared/lib/session-persistence";

/** A single session's usage row, flattened across all projects. */
export interface UsageRow {
  projectId: string;
  projectName: string;
  sessionId: string;
  title: string;
  engine: EngineId;
  createdAt: number;
  lastMessageAt: number;
  totalCost: number;
  /** Cumulative per-model usage (Claude only). Empty when unavailable. */
  modelUsage: Record<string, SessionMetaModelUsage>;
}

export type BucketGranularity = "day" | "week" | "month";

export interface UsageBucket {
  /** UTC timestamp (ms) of the start of the bucket. */
  bucketStart: number;
  cost: number;
  count: number;
}

export interface ProjectUsage {
  projectId: string;
  name: string;
  cost: number;
  count: number;
}

export interface EngineUsage {
  engine: EngineId;
  cost: number;
  count: number;
}

export interface ModelUsageBreakdown {
  model: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface UsageSummary {
  totalCost: number;
  sessionCount: number;
  byProject: ProjectUsage[];
  byEngine: EngineUsage[];
  byBucket: UsageBucket[];
  byModel: ModelUsageBreakdown[];
  topSessions: UsageRow[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Truncate a timestamp to the UTC start of its day. */
function startOfDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Truncate a timestamp to the UTC start of its ISO week (Monday). */
function startOfWeek(ms: number): number {
  const dayStart = startOfDay(ms);
  const dow = new Date(dayStart).getUTCDay(); // 0 = Sun … 6 = Sat
  const offsetToMonday = (dow + 6) % 7;
  return dayStart - offsetToMonday * DAY_MS;
}

/** Truncate a timestamp to the UTC start of its month. */
function startOfMonth(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function bucketStartFor(ms: number, granularity: BucketGranularity): number {
  switch (granularity) {
    case "day":
      return startOfDay(ms);
    case "week":
      return startOfWeek(ms);
    case "month":
      return startOfMonth(ms);
  }
}

/**
 * Aggregate a flat list of session usage rows into a dashboard summary.
 * Pure and deterministic — does not read the clock; callers pre-filter by range.
 */
export function aggregateUsage(
  rows: UsageRow[],
  granularity: BucketGranularity,
  topN = 10,
): UsageSummary {
  let totalCost = 0;
  const projectMap = new Map<string, ProjectUsage>();
  const engineMap = new Map<EngineId, EngineUsage>();
  const bucketMap = new Map<number, UsageBucket>();
  const modelMap = new Map<string, ModelUsageBreakdown>();

  for (const row of rows) {
    const cost = row.totalCost || 0;
    totalCost += cost;

    const proj = projectMap.get(row.projectId);
    if (proj) {
      proj.cost += cost;
      proj.count += 1;
    } else {
      projectMap.set(row.projectId, {
        projectId: row.projectId,
        name: row.projectName,
        cost,
        count: 1,
      });
    }

    const eng = engineMap.get(row.engine);
    if (eng) {
      eng.cost += cost;
      eng.count += 1;
    } else {
      engineMap.set(row.engine, { engine: row.engine, cost, count: 1 });
    }

    const bucketStart = bucketStartFor(row.lastMessageAt || row.createdAt, granularity);
    const bucket = bucketMap.get(bucketStart);
    if (bucket) {
      bucket.cost += cost;
      bucket.count += 1;
    } else {
      bucketMap.set(bucketStart, { bucketStart, cost, count: 1 });
    }

    // Per-model breakdown (Claude sessions that report modelUsage).
    for (const [model, entry] of Object.entries(row.modelUsage)) {
      const existing = modelMap.get(model);
      if (existing) {
        existing.cost += entry.costUSD || 0;
        existing.inputTokens += entry.inputTokens || 0;
        existing.outputTokens += entry.outputTokens || 0;
        existing.cacheReadTokens += entry.cacheReadInputTokens || 0;
        existing.cacheCreationTokens += entry.cacheCreationInputTokens || 0;
      } else {
        modelMap.set(model, {
          model,
          cost: entry.costUSD || 0,
          inputTokens: entry.inputTokens || 0,
          outputTokens: entry.outputTokens || 0,
          cacheReadTokens: entry.cacheReadInputTokens || 0,
          cacheCreationTokens: entry.cacheCreationInputTokens || 0,
        });
      }
    }
  }

  const byProject = [...projectMap.values()].sort((a, b) => b.cost - a.cost);
  const byEngine = [...engineMap.values()].sort((a, b) => b.cost - a.cost);
  const byBucket = [...bucketMap.values()].sort((a, b) => a.bucketStart - b.bucketStart);
  const byModel = [...modelMap.values()].sort((a, b) => b.cost - a.cost);
  const topSessions = [...rows]
    .sort((a, b) => (b.totalCost || 0) - (a.totalCost || 0))
    .slice(0, topN);

  return {
    totalCost,
    sessionCount: rows.length,
    byProject,
    byEngine,
    byBucket,
    byModel,
    topSessions,
  };
}

/** Filter rows to those active on/after `since` (ms). Pass null for "all time". */
export function filterRowsSince(rows: UsageRow[], since: number | null): UsageRow[] {
  if (since === null) return rows;
  return rows.filter((r) => (r.lastMessageAt || r.createdAt) >= since);
}

/** Whether spend has exceeded the budget. Returns false when no budget is set. */
export function isOverBudget(totalCost: number, monthlyBudgetUsd: number | null): boolean {
  if (monthlyBudgetUsd === null || monthlyBudgetUsd <= 0) return false;
  return totalCost > monthlyBudgetUsd;
}
