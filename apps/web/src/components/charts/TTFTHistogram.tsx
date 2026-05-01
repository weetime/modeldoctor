import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { ChartFrame, type DomainChartProps, themed, useChartDark } from "./_shared";

export interface HistogramBucket {
  lower: number;
  upper: number;
  count: number;
}

export interface TTFTHistogramSeries {
  runId: string;
  runLabel?: string;
  buckets: HistogramBucket[];
}

export interface TTFTHistogramProps extends DomainChartProps {
  series: TTFTHistogramSeries[];
  xLabel?: string;
  yLabel?: string;
}

function bucketKey(b: { lower: number; upper: number }): string {
  return `${b.lower}|${b.upper}`;
}

function bucketLabel(b: { lower: number; upper: number }): string {
  return `[${b.lower}, ${b.upper})`;
}

function alignBuckets(series: TTFTHistogramSeries[]): {
  labels: string[];
  perRun: Array<{ name: string; data: number[] }>;
} {
  const ordered = new Map<string, { lower: number; upper: number }>();
  for (const s of series) {
    for (const b of s.buckets) {
      const k = bucketKey(b);
      if (!ordered.has(k)) ordered.set(k, { lower: b.lower, upper: b.upper });
    }
  }
  const sorted = [...ordered.values()].sort((a, b) => a.lower - b.lower || a.upper - b.upper);
  const labels = sorted.map(bucketLabel);
  const perRun = series.map((s) => {
    const m = new Map(s.buckets.map((b) => [bucketKey(b), b.count]));
    return {
      name: s.runLabel ?? s.runId,
      data: sorted.map((b) => m.get(bucketKey(b)) ?? 0),
    };
  });
  return { labels, perRun };
}

function buildOption(series: TTFTHistogramSeries[], xLabel: string, yLabel: string): EChartsOption {
  const { labels, perRun } = alignBuckets(series);
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { data: perRun.map((r) => r.name) },
    xAxis: {
      type: "category",
      data: labels,
      name: xLabel,
      nameLocation: "middle",
      nameGap: 28,
      axisLabel: { interval: "auto", rotate: labels.length > 12 ? 30 : 0 },
    },
    yAxis: { type: "value", name: yLabel, nameLocation: "middle", nameGap: 40 },
    grid: { left: 56, right: 24, top: 40, bottom: 56 },
    series: perRun.map((r) => ({
      name: r.name,
      type: "bar" as const,
      barGap: "10%",
      data: r.data,
      large: true,
      largeThreshold: 2000,
    })),
  };
}

export function TTFTHistogram(props: TTFTHistogramProps) {
  const {
    series,
    xLabel = "TTFT (ms)",
    yLabel = "Count",
    ariaLabel,
    height = 360,
    loading,
    empty,
    theme = "auto",
  } = props;

  const dark = useChartDark(theme);
  const isEmpty = empty ?? (series.length === 0 || series.every((s) => s.buckets.length === 0));

  const option = useMemo(
    () => themed(buildOption(series, xLabel, yLabel), dark),
    [series, xLabel, yLabel, dark],
  );

  return (
    <ChartFrame ariaLabel={ariaLabel} height={height} loading={loading} empty={isEmpty}>
      <ReactECharts option={option} style={{ height: "100%", width: "100%" }} notMerge lazyUpdate />
    </ChartFrame>
  );
}
