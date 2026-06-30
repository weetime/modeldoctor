import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { ChartFrame, themed, useChartTokens } from "./_shared";

export interface SweepLinePoint {
  x: number;
  y: number | null;
}

export interface SweepLineSeries {
  /** Series identity label (engine, e.g. "vLLM-Ascend"). */
  label: string;
  /** Series-identity color (assigned by caller; sweep colors BY ENGINE, so a
   * 3-engine sweep needs only 3 colors — the 8-color palette never wraps). */
  color: string;
  /** Primary line (solid) — e.g. p50, or the sole metric. */
  points: SweepLinePoint[];
  /** Optional secondary line (dashed, same color, no point labels) — e.g. p95. */
  secondary?: SweepLinePoint[];
}

export interface SweepLineChartProps {
  title?: string;
  series: SweepLineSeries[];
  /** y-axis label (e.g. "Output tok/s", "TTFT (ms)"). */
  yLabel: string;
  /** x-axis label (default "concurrency"). */
  xLabel?: string;
  /** log x (concurrency spans octaves — default true). */
  logX?: boolean;
  /** log y (e.g. TTFT spans orders of magnitude — default false). */
  logY?: boolean;
  /** higher-is-better → headroom above max; charts read top-down otherwise. */
  height?: number;
  /** Format a value for tooltip + point labels (default 1 decimal). */
  valueFormatter?: (v: number) => string;
  /** Legend hint for the dashed secondary line (e.g. "p95"); primary "p50". */
  primaryName?: string;
  secondaryName?: string;
}

const LABEL = { value: "#1f2328", baseline: "#59636e" };

/**
 * Generic metric-vs-parameter line chart for sweep reports: x = a swept param
 * (concurrency), one (optionally two) line(s) per series (engine). Markers +
 * static value labels on every primary point so it reads in print/PDF without
 * hover. Colors are passed in BY SERIES (engine) — no per-run palette wrap.
 * Generalizes ThroughputConcurrencyChart (single rps metric) to any metric,
 * unit, log/linear axes, and an optional dashed secondary line (p95 alongside
 * p50). Always-light report paper, independent of app theme.
 */
export function SweepLineChart({
  title,
  series,
  yLabel,
  xLabel = "concurrency",
  logX = true,
  logY = false,
  height = 320,
  valueFormatter = (v) => v.toFixed(1),
  primaryName,
  secondaryName,
}: SweepLineChartProps): JSX.Element {
  const tokens = useChartTokens();
  const isEmpty = series.length === 0 || series.every((s) => s.points.every((p) => p.y === null));

  const option = useMemo<EChartsOption>(() => {
    const ecSeries = series.flatMap((s) => {
      const toData = (pts: SweepLinePoint[]) =>
        [...pts]
          .filter((p) => p.y !== null)
          .sort((a, b) => a.x - b.x)
          .map((p) => [p.x, p.y] as [number, number]);
      const solid = {
        name: secondaryName && primaryName ? `${s.label} · ${primaryName}` : s.label,
        type: "line" as const,
        data: toData(s.points),
        itemStyle: { color: s.color },
        lineStyle: { color: s.color, width: 2 },
        symbol: "circle" as const,
        symbolSize: 6,
        label: {
          show: true,
          position: "top" as const,
          color: LABEL.value,
          fontSize: 10,
          fontWeight: 500 as const,
          formatter: (p: { value: [number, number] | unknown }) =>
            Array.isArray(p.value) && typeof p.value[1] === "number"
              ? valueFormatter(p.value[1])
              : "",
        },
      };
      if (!s.secondary) return [solid];
      const dashed = {
        name: `${s.label} · ${secondaryName ?? "p95"}`,
        type: "line" as const,
        data: toData(s.secondary),
        itemStyle: { color: s.color },
        lineStyle: { color: s.color, width: 1.4, type: "dashed" as const, opacity: 0.75 },
        symbol: "rect" as const,
        symbolSize: 5,
      };
      return [solid, dashed];
    });

    const multi = ecSeries.length > 1;
    return themed(
      {
        tooltip: {
          trigger: "axis",
          valueFormatter: (val: unknown) =>
            typeof val === "number" ? valueFormatter(val) : String(val ?? ""),
        },
        legend: multi ? { type: "scroll", top: 0, textStyle: { color: LABEL.value } } : undefined,
        xAxis: {
          type: logX ? ("log" as const) : ("value" as const),
          name: xLabel,
          nameLocation: "middle" as const,
          nameGap: 28,
          axisLabel: { color: LABEL.baseline, formatter: (v: number) => String(v) },
        },
        yAxis: {
          type: logY ? ("log" as const) : ("value" as const),
          name: yLabel,
          nameLocation: "middle" as const,
          nameGap: 48,
          ...(logY ? {} : { min: 0, max: (v: { max: number }) => (v.max > 0 ? v.max * 1.18 : 1) }),
          axisLabel: { color: LABEL.baseline, formatter: (v: number) => valueFormatter(v) },
        },
        grid: { left: 70, right: 28, top: multi ? 52 : 28, bottom: 48 },
        series: ecSeries,
      },
      tokens,
    );
  }, [series, yLabel, xLabel, logX, logY, valueFormatter, primaryName, secondaryName, tokens]);

  return (
    <div className="rounded-md border border-border p-4">
      {title ? <div className="mb-2 text-sm font-medium">{title}</div> : null}
      <ChartFrame ariaLabel={title ?? yLabel} height={height} empty={isEmpty}>
        <ReactECharts
          option={option}
          style={{ height: "100%", width: "100%" }}
          notMerge
          lazyUpdate
        />
      </ChartFrame>
    </div>
  );
}
