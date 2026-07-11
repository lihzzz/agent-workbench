import { memo } from "react";

export interface BarDatum {
  label: string;
  value: number;
}

/**
 * Dependency-free SVG bar chart. Mirrors the project's existing SVG-drawing
 * approach (see ContextGauge) rather than pulling in a charting library.
 */
export const MiniBarChart = memo(function MiniBarChart({
  data,
  height = 120,
  barColor = "var(--color-primary, #6366f1)",
  formatValue,
}: {
  data: BarDatum[];
  height?: number;
  barColor?: string;
  formatValue?: (value: number) => string;
}) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-foreground/[0.06] text-xs text-muted-foreground"
        style={{ height }}
      >
        No data for this range
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.value), 0);
  const gap = 6;
  const count = data.length;
  // Use a viewBox so bars scale to container width responsively.
  const vbWidth = 320;
  const barWidth = Math.max(2, (vbWidth - gap * (count - 1)) / count);
  const chartHeight = height - 22; // leave room for the x-axis labels

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${vbWidth} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        role="img"
        aria-label="Usage bar chart"
      >
        {data.map((d, i) => {
          const barHeight = max > 0 ? (d.value / max) * chartHeight : 0;
          const x = i * (barWidth + gap);
          const y = chartHeight - barHeight;
          return (
            <g key={`${d.label}-${i}`}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, d.value > 0 ? 1 : 0)}
                rx={2}
                fill={barColor}
                opacity={0.85}
              >
                <title>
                  {d.label}: {formatValue ? formatValue(d.value) : d.value}
                </title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{data[0]?.label}</span>
        {data.length > 1 && <span>{data[data.length - 1]?.label}</span>}
      </div>
    </div>
  );
});
