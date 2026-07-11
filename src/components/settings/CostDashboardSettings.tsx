import { memo, useMemo, useState } from "react";
import { DollarSign, TrendingUp, FolderTree, Cpu, AlertTriangle, RefreshCw, Boxes } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsHeader, SettingsSection, SettingsSelect } from "@/components/settings/shared";
import { MiniBarChart, type BarDatum } from "@/components/settings/MiniBarChart";
import { useUsageData } from "@/hooks/useUsageData";
import {
  aggregateUsage,
  filterRowsSince,
  isOverBudget,
  type BucketGranularity,
} from "@/lib/session/usage-aggregation";
import { useSettingsStore } from "@/stores/settings-store";
import type { Project } from "@/types";

interface CostDashboardSettingsProps {
  projects: Project[];
}

type RangeOption = "7d" | "30d" | "90d" | "all";

const RANGE_OPTIONS: Array<{ value: RangeOption; label: string }> = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

const GRANULARITY_OPTIONS: Array<{ value: BucketGranularity; label: string }> = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
];

const RANGE_DAYS: Record<RangeOption, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatBucketLabel(bucketStart: number, granularity: BucketGranularity): string {
  const d = new Date(bucketStart);
  if (granularity === "month") {
    return d.toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export const CostDashboardSettings = memo(function CostDashboardSettings({
  projects,
}: CostDashboardSettingsProps) {
  const { rows, loading, refresh } = useUsageData(projects);
  const [range, setRange] = useState<RangeOption>("30d");
  const [granularity, setGranularity] = useState<BucketGranularity>("day");

  const monthlyBudgetUsd = useSettingsStore((s) => s.monthlyBudgetUsd);
  const setMonthlyBudgetUsd = useSettingsStore((s) => s.setMonthlyBudgetUsd);

  // "Now" comes from the render moment — fine for a non-streaming settings panel.
  const since = useMemo(() => {
    const days = RANGE_DAYS[range];
    if (days === null) return null;
    return Date.now() - days * DAY_MS;
  }, [range]);

  const summary = useMemo(() => {
    const filtered = filterRowsSince(rows, since);
    return aggregateUsage(filtered, granularity);
  }, [rows, since, granularity]);

  // Current-month spend for budget comparison (always month-to-date, ignores range filter).
  const monthSpend = useMemo(() => {
    const now = new Date();
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    return filterRowsSince(rows, monthStart).reduce((sum, r) => sum + (r.totalCost || 0), 0);
  }, [rows]);

  const overBudget = isOverBudget(monthSpend, monthlyBudgetUsd);

  const chartData: BarDatum[] = useMemo(
    () =>
      summary.byBucket.map((b) => ({
        label: formatBucketLabel(b.bucketStart, granularity),
        value: b.cost,
      })),
    [summary.byBucket, granularity],
  );

  return (
    <div className="flex h-full flex-col">
      <SettingsHeader
        title="Usage & Cost"
        description="Track spend across all your projects and sessions"
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          {/* Controls */}
          <div className="flex items-center justify-between gap-3 py-3">
            <div className="flex items-center gap-2">
              <SettingsSelect value={range} onValueChange={setRange} options={RANGE_OPTIONS} />
              <SettingsSelect
                value={granularity}
                onValueChange={setGranularity}
                options={GRANULARITY_OPTIONS}
              />
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={refresh} title="Refresh">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {/* Budget alert */}
          {overBudget && (
            <div className="mb-2 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                Month-to-date spend ({formatCost(monthSpend)}) exceeds your budget of{" "}
                {formatCost(monthlyBudgetUsd ?? 0)}.
              </span>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3 py-2">
            <SummaryCard
              icon={<DollarSign className="h-4 w-4" />}
              label="Total cost"
              value={formatCost(summary.totalCost)}
            />
            <SummaryCard
              icon={<TrendingUp className="h-4 w-4" />}
              label="Sessions"
              value={String(summary.sessionCount)}
            />
            <SummaryCard
              icon={<DollarSign className="h-4 w-4" />}
              label="This month"
              value={formatCost(monthSpend)}
            />
          </div>

          {/* Trend chart */}
          <SettingsSection icon={TrendingUp} label="Spend over time">
            <MiniBarChart data={chartData} formatValue={formatCost} />
          </SettingsSection>

          {/* By project */}
          <SettingsSection icon={FolderTree} label="By project">
            {summary.byProject.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">No usage in this range.</p>
            ) : (
              <div className="space-y-1">
                {summary.byProject.map((p) => (
                  <BreakdownRow
                    key={p.projectId}
                    name={p.name}
                    sub={`${p.count} session${p.count !== 1 ? "s" : ""}`}
                    value={formatCost(p.cost)}
                    fraction={summary.totalCost > 0 ? p.cost / summary.totalCost : 0}
                  />
                ))}
              </div>
            )}
          </SettingsSection>

          {/* By engine */}
          <SettingsSection icon={Cpu} label="By engine">
            {summary.byEngine.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">No usage in this range.</p>
            ) : (
              <div className="space-y-1">
                {summary.byEngine.map((e) => (
                  <BreakdownRow
                    key={e.engine}
                    name={e.engine}
                    sub={`${e.count} session${e.count !== 1 ? "s" : ""}`}
                    value={formatCost(e.cost)}
                    fraction={summary.totalCost > 0 ? e.cost / summary.totalCost : 0}
                  />
                ))}
              </div>
            )}
          </SettingsSection>

          {/* By model (Claude per-model breakdown) */}
          <SettingsSection icon={Boxes} label="By model">
            {summary.byModel.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">
                No per-model data. Cost breakdown by model is available for Claude sessions.
              </p>
            ) : (
              <div className="space-y-1">
                {summary.byModel.map((m) => {
                  const totalModelCostInRange = summary.byModel.reduce((s, x) => s + x.cost, 0);
                  return (
                    <BreakdownRow
                      key={m.model}
                      name={m.model}
                      sub={`${formatTokens(m.inputTokens + m.outputTokens)} tok`}
                      value={formatCost(m.cost)}
                      fraction={totalModelCostInRange > 0 ? m.cost / totalModelCostInRange : 0}
                    />
                  );
                })}
              </div>
            )}
          </SettingsSection>

          {/* Top sessions */}
          <SettingsSection icon={DollarSign} label="Most expensive sessions">
            {summary.topSessions.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">No usage in this range.</p>
            ) : (
              <div className="space-y-1">
                {summary.topSessions
                  .filter((s) => s.totalCost > 0)
                  .map((s) => (
                    <div
                      key={s.sessionId}
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-xs hover:bg-foreground/[0.03]"
                    >
                      <span className="min-w-0 flex-1 truncate text-foreground">{s.title}</span>
                      <span className="shrink-0 text-muted-foreground">{s.projectName}</span>
                      <span className="shrink-0 font-mono text-foreground">{formatCost(s.totalCost)}</span>
                    </div>
                  ))}
              </div>
            )}
          </SettingsSection>

          {/* Budget */}
          <SettingsSection icon={AlertTriangle} label="Monthly budget">
            <div className="flex items-center justify-between gap-6 py-2">
              <p className="text-xs text-muted-foreground">
                Get a warning when this month's spend exceeds your budget. Leave empty to disable.
              </p>
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground">$</span>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  placeholder="0"
                  value={monthlyBudgetUsd ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setMonthlyBudgetUsd(v === "" ? null : Number(v));
                  }}
                  className="h-8 w-24"
                />
              </div>
            </div>
          </SettingsSection>

          <p className="py-3 text-[11px] text-muted-foreground">
            Cost data reflects Claude and ACP sessions that report usage. Codex sessions may not
            include cost information.
          </p>
        </div>
      </ScrollArea>
    </div>
  );
});

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[11px] uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

function BreakdownRow({
  name,
  sub,
  value,
  fraction,
}: {
  name: string;
  sub: string;
  value: string;
  fraction: number;
}) {
  return (
    <div className="rounded-md px-2 py-1.5 hover:bg-foreground/[0.03]">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="min-w-0 flex-1 truncate font-medium text-foreground capitalize">{name}</span>
        <span className="shrink-0 text-muted-foreground">{sub}</span>
        <span className="shrink-0 font-mono text-foreground">{value}</span>
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-foreground/[0.06]">
        <div
          className="h-full rounded-full bg-primary/70"
          style={{ width: `${Math.min(100, Math.round(fraction * 100))}%` }}
        />
      </div>
    </div>
  );
}
