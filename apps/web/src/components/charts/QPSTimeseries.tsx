import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { ChartFrame, type DomainChartProps, themed, useChartTokens } from "./_shared";

export interface QPSTimeseriesSeries {
  runId: string;
  runLabel?: string;
  points: Array<[number, number]>;
}

export interface QPSTimeseriesProps extends DomainChartProps {
  series: QPSTimeseriesSeries[];
  yLabel?: string;
  colorMap?: Record<string, string>;
}

function buildOption(
  series: QPSTimeseriesSeries[],
  yLabel: string,
  colorMap: Record<string, string> | undefined,
): EChartsOption {
  const ecSeries = series.map((s) => {
    const color = colorMap?.[s.runId];
    return {
      name: s.runLabel ?? s.runId,
      type: "line" as const,
      showSymbol: false,
      sampling: "lttb" as const,
      progressive: 2000,
      progressiveThreshold: 5000,
      data: s.points,
      ...(color ? { itemStyle: { color }, lineStyle: { color } } : {}),
    };
  });
  return {
    tooltip: { trigger: "axis" },
    legend: { data: ecSeries.map((s) => s.name), type: "scroll", top: 0, left: 0, right: 24 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: yLabel, nameLocation: "middle", nameGap: 40 },
    grid: { left: 56, right: 24, top: 56, bottom: 64 },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 8 }],
    series: ecSeries,
  };
}

export function QPSTimeseries(props: QPSTimeseriesProps) {
  const { series, yLabel = "QPS", colorMap, ariaLabel, height = 360, loading, empty } = props;

  const tokens = useChartTokens();
  const isEmpty = empty ?? (series.length === 0 || series.every((s) => s.points.length === 0));

  const option = useMemo(
    () => themed(buildOption(series, yLabel, colorMap), tokens),
    [series, yLabel, colorMap, tokens],
  );

  return (
    <ChartFrame ariaLabel={ariaLabel} height={height} loading={loading} empty={isEmpty}>
      <ReactECharts option={option} style={{ height: "100%", width: "100%" }} notMerge lazyUpdate />
    </ChartFrame>
  );
}
