import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { ChartFrame, themed, useChartTokens } from "./_shared";

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
}

type LabelParam = { dataIndex: number; value: unknown };

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
}: StageBarChartProps): JSX.Element {
  const tokens = useChartTokens();
  const isEmpty = empty ?? data.length === 0;
  const label = ariaLabel ?? title ?? "stage-bar";

  const option = useMemo<EChartsOption>(() => {
    const lc = {
      value: labelColors?.value ?? tokens.textColor,
      up: labelColors?.up ?? "#1a7f37",
      down: labelColors?.down ?? "#d1242f",
      baseline: labelColors?.baseline ?? tokens.axisLabelColor,
    };
    const categories = data.map((d) => d.stage);

    const ecSeries = series.map((s) => {
      const values = data.map((d) => {
        const v = d[s.key];
        return typeof v === "number" ? v : null;
      });
      const baseVal = baselineIndex != null && baselineIndex >= 0 ? values[baselineIndex] : null;

      const labelFor = (idx: number, value: number): string => {
        const valueStr = fmtValue(value, s.decimals);
        // No baseline context, or this series opts out of trend → value only.
        if (baselineIndex == null || s.higherIsBetter == null) return valueStr;
        if (idx === baselineIndex) return `${valueStr}\n{base|baseline}`;
        if (baseVal == null || baseVal === 0) return valueStr;
        const deltaPct = ((value - baseVal) / Math.abs(baseVal)) * 100;
        if (Math.abs(deltaPct) < 0.5) return `${valueStr}\n{base|≈}`;
        const arrow = deltaPct > 0 ? "↑" : "↓";
        const better = deltaPct > 0 === s.higherIsBetter;
        const tone = better ? "up" : "down";
        return `${valueStr}\n{${tone}|${arrow}${Math.abs(deltaPct).toFixed(0)}%}`;
      };

      return {
        name: s.label,
        type: "bar" as const,
        data: values,
        itemStyle: { color: s.color },
        label: showValueLabels
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
        tooltip: { trigger: "axis" },
        legend: series.length > 1 ? { type: "scroll", top: 0 } : undefined,
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
          axisLabel: { color: lc.baseline },
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
    showValueLabels,
    baselineIndex,
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
