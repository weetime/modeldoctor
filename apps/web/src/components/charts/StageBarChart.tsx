import type { PanelUnit } from "@modeldoctor/contracts";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { ChartFrame, themed, useChartTokens } from "./_shared";
import { formatPanelValue } from "./format-unit";

export interface StageBarSeries {
  key: string;
  label: string;
  color: string;
  /** Decimal places for the static value label (default: up to 2, trimmed). */
  decimals?: number;
  /**
   * Direction for the per-bar delta vs baseline: `true` = higher is better
   * (throughput), `false` = lower is better (latency / error rate). When set
   * together with `baselineIndex`, each non-baseline bar shows a colored
   * ↑/↓ % annotation. Omit to suppress the trend annotation for this series.
   */
  higherIsBetter?: boolean;
}

export interface StageBarDatum {
  stage: string;
  [seriesKey: string]: string | number | null;
}

/** Fixed label/trend colors. Pass Primer light values for the always-light
 * report "paper" so labels stay readable on screen, in PDF, and on export
 * regardless of the app's dark/light theme. */
export interface StageBarLabelColors {
  /** Value text + category (A/B/C) axis labels. */
  value?: string;
  /** Delta annotation when the bar is better than baseline. */
  up?: string;
  /** Delta annotation when the bar is worse than baseline. */
  down?: string;
  /** Baseline marker text, "≈" ties, y-axis ticks, reference line. */
  baseline?: string;
}

export interface StageBarChartProps {
  title?: string;
  data: StageBarDatum[];
  series: StageBarSeries[];
  height?: number;
  yLabel?: string;
  ariaLabel?: string;
  loading?: boolean;
  empty?: boolean | string;
  /** Render static value labels on every bar (PDF/print-safe). Default true. */
  showValueLabels?: boolean;
  /**
   * Index into `data` of the baseline stage. Enables per-bar delta annotations
   * and (for single-series charts) a dashed reference line at the baseline
   * value. Omit to render values only.
   */
  baselineIndex?: number;
  /** Fixed label/trend colors (defaults to theme tokens + Primer green/red). */
  labelColors?: StageBarLabelColors;
  /**
   * Per-datum bar colors, index-aligned with `data`. Only applied to
   * single-series charts (QPS / error-rate) where each bar IS a run and
   * must carry that run's identity color across sibling charts.
   */
  barColors?: readonly (string | undefined)[];
  /**
   * Series-key of the baseline run for run-pivoted charts (series = runs,
   * x = percentile categories). Mutually exclusive with `baselineIndex`.
   * Non-baseline series annotate ↑/↓ % vs the baseline series' value at the
   * same x category; the baseline series labels itself "baseline".
   */
  baselineSeriesKey?: string;
  /**
   * Render as grouped bars (default) or multi-line. Lines read better for
   * percentile distributions (p50→p95→p99 across runs) where grouped bars get
   * crowded; bars stay the default for single-scalar-per-run charts.
   */
  variant?: "bar" | "line";
  /**
   * Shared `PanelUnit` (ms / % / rps / …). When set, the y-axis ticks, tooltip,
   * and bar labels all format through `formatPanelValue` — the same system the
   * time-series charts use — so units and precision stay consistent app-wide
   * and the y-axis never shows raw full-precision floats. Takes precedence over
   * `valueFormatter`.
   */
  unit?: PanelUnit;
  /**
   * Escape-hatch value formatter for the tooltip + static labels when `unit`
   * doesn't fit. When omitted (and no `unit`), falls back to a
   * thousands-separated, up-to-2-decimal default.
   */
  valueFormatter?: (v: number) => string;
}

type LabelParam = { dataIndex: number; value: unknown };

/**
 * Delta annotation suffix vs a baseline value, shared by both baseline modes
 * (stage-positional `baselineIndex` and series-keyed `baselineSeriesKey`).
 * Returns the ECharts rich-text fragment to append after the value line, or
 * "" when no annotation applies.
 */
export function deltaAnnotation(
  value: number,
  baseVal: number | null,
  higherIsBetter: boolean,
): string {
  if (baseVal == null || baseVal === 0) return "";
  const deltaPct = ((value - baseVal) / Math.abs(baseVal)) * 100;
  if (Math.abs(deltaPct) < 0.5) return "\n{base|≈}";
  const arrow = deltaPct > 0 ? "↑" : "↓";
  const better = deltaPct > 0 === higherIsBetter;
  const tone = better ? "up" : "down";
  return `\n{${tone}|${arrow}${Math.abs(deltaPct).toFixed(0)}%}`;
}

function fmtValue(v: number, decimals?: number): string {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? 2,
  });
}

/**
 * Categorical-X grouped bar chart for stage-aligned metrics
 * (QPS / TTFT percentiles / TPOT / etc. across "stages" = compare buckets).
 *
 * Values are rendered as static labels on top of every bar (not just on hover)
 * so the chart reads correctly in print / PDF / HTML export. With a
 * `baselineIndex`, each non-baseline bar also carries a colored ↑/↓ % delta vs
 * the baseline stage, and single-series charts draw a dashed reference line at
 * the baseline value.
 *
 * Differs from {@link BarChart} which is time-axis (timestamp samples).
 */
export function StageBarChart({
  title,
  data,
  series,
  height = 300,
  yLabel,
  ariaLabel,
  loading,
  empty,
  showValueLabels = true,
  baselineIndex,
  labelColors,
  barColors,
  baselineSeriesKey,
  variant = "bar",
  unit,
  valueFormatter,
}: StageBarChartProps): JSX.Element {
  const tokens = useChartTokens();
  const isEmpty = empty ?? data.length === 0;
  const label = ariaLabel ?? title ?? "stage-bar";
  // Static value labels stay on for BOTH bars and lines — the report is
  // exported to PDF/HTML, which has no hover tooltip, so every point must carry
  // its value. Line points that would collide are nudged apart via the
  // per-series `labelLayout.moveOverlap` below rather than hidden.
  const showLabels = showValueLabels;

  const option = useMemo<EChartsOption>(() => {
    // Unit-aware value formatter shared by the tooltip, y-axis ticks, and bar
    // labels. `unit` (shared PanelUnit) wins, then the escape-hatch
    // `valueFormatter`, then a plain thousands-separated number.
    const fmt = (v: number): string =>
      unit ? formatPanelValue(v, unit) : valueFormatter ? valueFormatter(v) : fmtValue(v);
    const lc = {
      value: labelColors?.value ?? tokens.textColor,
      up: labelColors?.up ?? "#1a7f37",
      down: labelColors?.down ?? "#d1242f",
      baseline: labelColors?.baseline ?? tokens.axisLabelColor,
    };
    const categories = data.map((d) => d.stage);

    // Series-keyed baseline (run-pivoted charts): per-category values of the
    // baseline run, compared against by every other series at the same index.
    const baselineSeriesValues =
      baselineSeriesKey != null
        ? data.map((d) => {
            const v = d[baselineSeriesKey];
            return typeof v === "number" ? v : null;
          })
        : null;

    const ecSeries = series.map((s) => {
      const values = data.map((d) => {
        const v = d[s.key];
        return typeof v === "number" ? v : null;
      });
      const baseVal = baselineIndex != null && baselineIndex >= 0 ? values[baselineIndex] : null;

      const labelFor = (idx: number, value: number): string => {
        const valueStr = unit
          ? formatPanelValue(value, unit)
          : valueFormatter
            ? valueFormatter(value)
            : fmtValue(value, s.decimals);
        // No baseline context, or this series opts out of trend → value only.
        if (s.higherIsBetter == null) return valueStr;
        if (baselineSeriesValues != null) {
          if (s.key === baselineSeriesKey) return `${valueStr}\n{base|baseline}`;
          return valueStr + deltaAnnotation(value, baselineSeriesValues[idx], s.higherIsBetter);
        }
        if (baselineIndex == null) return valueStr;
        if (idx === baselineIndex) return `${valueStr}\n{base|baseline}`;
        return valueStr + deltaAnnotation(value, baseVal, s.higherIsBetter);
      };

      // Single-series charts may carry per-bar identity colors (each bar = a
      // run); itemStyle on the datum overrides the series-level color.
      const seriesData =
        series.length === 1 && barColors
          ? values.map((v, i) =>
              barColors[i] ? { value: v, itemStyle: { color: barColors[i] } } : v,
            )
          : values;

      return {
        name: s.label,
        type: variant,
        ...(variant === "line"
          ? { symbol: "circle" as const, symbolSize: 6, lineStyle: { width: 2 } }
          : {}),
        data: seriesData,
        itemStyle: { color: s.color },
        label: showLabels
          ? {
              show: true,
              position: "top" as const,
              color: lc.value,
              fontSize: 11,
              fontWeight: 500 as const,
              lineHeight: 14,
              formatter: (p: LabelParam) =>
                typeof p.value === "number" ? labelFor(p.dataIndex, p.value) : "",
              rich: {
                up: { color: lc.up, fontSize: 10, fontWeight: 700 as const },
                down: { color: lc.down, fontSize: 10, fontWeight: 700 as const },
                base: { color: lc.baseline, fontSize: 10 },
              },
            }
          : undefined,
        // Line series stack multiple near-equal points at one x (e.g. all runs
        // at p50), so their labels collide. Nudge overlapping labels apart
        // vertically instead of hiding them — keeps every value for PDF export.
        labelLayout:
          showLabels && variant === "line"
            ? { moveOverlap: "shiftY" as const, hideOverlap: false }
            : undefined,
        // Dashed reference line at the baseline value — only meaningful for a
        // single series (multiple series have different baselines).
        markLine:
          baselineIndex != null && series.length === 1 && baseVal != null
            ? {
                silent: true,
                symbol: "none" as const,
                lineStyle: { type: "dashed" as const, color: lc.baseline, width: 1 },
                label: { show: false },
                data: [{ yAxis: baseVal }],
              }
            : undefined,
      };
    });

    return themed(
      {
        tooltip: {
          trigger: "axis",
          // Format tooltip values with the same unit-aware formatter as the
          // labels — without this ECharts prints raw full-precision floats.
          valueFormatter: (val: unknown) =>
            typeof val === "number" ? fmt(val) : String(val ?? ""),
        },
        legend:
          series.length > 1
            ? { type: "scroll", top: 0, textStyle: { color: tokens.textColor } }
            : undefined,
        xAxis: {
          type: "category",
          data: categories,
          // Category labels (A/B/C) are the key to reading the chart — make
          // them prominent and readable on the light report paper.
          axisLabel: { color: lc.value, fontWeight: 600, fontSize: 12 },
        },
        yAxis: {
          type: "value",
          // 20% headroom so the top value labels are not clipped. Keep it
          // fractional — `Math.ceil` would round sub-1 maxima (small error
          // rates / throughputs) up to 1 and squash the bars flat.
          max: (v: { max: number }) => (v.max > 0 ? v.max * 1.2 : 1),
          // Format ticks through the same unit-aware formatter so the headroom
          // max never renders as a raw float (e.g. "1.6612971606561588").
          axisLabel: { color: lc.baseline, formatter: (v: number) => fmt(v) },
          ...(yLabel ? { name: yLabel, nameLocation: "middle", nameGap: 40 } : {}),
        },
        grid: { left: 56, right: 24, top: series.length > 1 ? 56 : 24, bottom: 32 },
        series: ecSeries,
      },
      tokens,
    );
  }, [
    data,
    series,
    yLabel,
    tokens,
    showLabels,
    baselineIndex,
    baselineSeriesKey,
    barColors,
    variant,
    unit,
    valueFormatter,
    labelColors?.value,
    labelColors?.up,
    labelColors?.down,
    labelColors?.baseline,
  ]);

  return (
    <div className="rounded-md border border-border p-4">
      {title ? <div className="mb-2 text-sm font-medium">{title}</div> : null}
      <ChartFrame ariaLabel={label} height={height} loading={loading} empty={isEmpty}>
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
