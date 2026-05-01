import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { ChartFrame, type DomainChartProps, themed, useChartDark } from "./_shared";

export interface LatencyCDFSeries {
  runId: string;
  runLabel?: string;
  samples?: number[];
  cdf?: Array<[number, number]>;
}

export interface LatencyCDFProps extends DomainChartProps {
  series: LatencyCDFSeries[];
  xLabel?: string;
}

function computeCDF(samples: number[]): Array<[number, number]> {
  const n = samples.length;
  if (n === 0) return [];
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted.map((x, i) => [x, (i + 1) / n]);
}

function resolveCDF(s: LatencyCDFSeries): Array<[number, number]> {
  if (s.cdf && s.cdf.length > 0) return s.cdf;
  if (s.samples && s.samples.length > 0) return computeCDF(s.samples);
  return [];
}

function buildOption(series: LatencyCDFSeries[], xLabel: string): EChartsOption {
  const ecSeries = series
    .map((s) => ({ raw: s, data: resolveCDF(s) }))
    .filter(({ data }) => data.length > 0)
    .map(({ raw, data }) => ({
      name: raw.runLabel ?? raw.runId,
      type: "line" as const,
      step: "end" as const,
      showSymbol: false,
      sampling: "lttb" as const,
      progressive: 2000,
      progressiveThreshold: 5000,
      data,
    }));

  return {
    tooltip: { trigger: "axis" },
    legend: { data: ecSeries.map((s) => s.name) },
    xAxis: { type: "value", name: xLabel, nameLocation: "middle", nameGap: 28 },
    yAxis: {
      type: "value",
      min: 0,
      max: 1,
      name: "Cumulative",
      nameLocation: "middle",
      nameGap: 48,
      axisLabel: { formatter: (v: number) => `${Math.round(v * 100)}%` },
    },
    grid: { left: 64, right: 24, top: 40, bottom: 48 },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 18 }],
    series: ecSeries,
  };
}

export function LatencyCDF(props: LatencyCDFProps) {
  const {
    series,
    xLabel = "Latency (ms)",
    ariaLabel,
    height = 360,
    loading,
    empty,
    theme = "auto",
  } = props;

  const dark = useChartDark(theme);
  const isEmpty = empty ?? (series.length === 0 || series.every((s) => resolveCDF(s).length === 0));

  const option = useMemo(() => themed(buildOption(series, xLabel), dark), [series, xLabel, dark]);

  return (
    <ChartFrame ariaLabel={ariaLabel} height={height} loading={loading} empty={isEmpty}>
      <ReactECharts option={option} style={{ height: "100%", width: "100%" }} notMerge lazyUpdate />
    </ChartFrame>
  );
}
