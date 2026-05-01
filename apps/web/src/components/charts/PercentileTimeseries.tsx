import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { ChartFrame, type DomainChartProps, themed, useChartDark } from "./_shared";

export type Percentile = "p50" | "p90" | "p95" | "p99";

export interface PercentileTimeseriesSeries {
  runId: string;
  runLabel?: string;
  percentiles: Partial<Record<Percentile, Array<[number, number]>>>;
}

export interface PercentileTimeseriesProps extends DomainChartProps {
  series: PercentileTimeseriesSeries[];
  yLabel?: string;
}

const PERCENTILE_ORDER: Percentile[] = ["p50", "p90", "p95", "p99"];

function buildOption(series: PercentileTimeseriesSeries[], yLabel: string): EChartsOption {
  const multiRun = series.length > 1;
  const flat = series.flatMap((s) =>
    PERCENTILE_ORDER.flatMap((p) => {
      const data = s.percentiles[p];
      if (!data || data.length === 0) return [];
      const runName = s.runLabel ?? s.runId;
      const name = multiRun ? `${runName} · ${p}` : p;
      return [
        {
          name,
          type: "line" as const,
          showSymbol: false,
          smooth: false,
          sampling: "lttb" as const,
          progressive: 2000,
          progressiveThreshold: 5000,
          data,
        },
      ];
    }),
  );
  return {
    tooltip: { trigger: "axis" },
    legend: { data: flat.map((s) => s.name) },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: yLabel, nameLocation: "middle", nameGap: 40 },
    grid: { left: 56, right: 24, top: 40, bottom: 40 },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 18 }],
    series: flat,
  };
}

export function PercentileTimeseries(props: PercentileTimeseriesProps) {
  const {
    series,
    yLabel = "Latency (ms)",
    ariaLabel,
    height = 360,
    loading,
    empty,
    theme = "auto",
  } = props;

  const dark = useChartDark(theme);
  const isEmpty =
    empty ??
    (series.length === 0 ||
      series.every((s) =>
        PERCENTILE_ORDER.every((p) => !s.percentiles[p] || s.percentiles[p]?.length === 0),
      ));

  const option = useMemo(() => themed(buildOption(series, yLabel), dark), [series, yLabel, dark]);

  return (
    <ChartFrame ariaLabel={ariaLabel} height={height} loading={loading} empty={isEmpty}>
      <ReactECharts option={option} style={{ height: "100%", width: "100%" }} notMerge lazyUpdate />
    </ChartFrame>
  );
}
