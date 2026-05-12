import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { ChartFrame, themed, useChartTokens } from "./_shared";

export interface StageBarSeries {
  key: string;
  label: string;
  color: string;
}

export interface StageBarDatum {
  stage: string;
  [seriesKey: string]: string | number | null;
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
}

/**
 * Categorical-X grouped bar chart for stage-aligned metrics
 * (QPS / TTFT percentiles / TPOT / etc. across "stages" = compare buckets).
 *
 * Differs from {@link BarChart} which is time-axis (timestamp samples).
 * Built for the SavedCompare report where each row is one stage and columns
 * are user-defined series keyed by `series[*].key`.
 */
export function StageBarChart({
  title,
  data,
  series,
  height = 280,
  yLabel,
  ariaLabel,
  loading,
  empty,
}: StageBarChartProps): JSX.Element {
  const tokens = useChartTokens();
  const isEmpty = empty ?? data.length === 0;
  const label = ariaLabel ?? title ?? "stage-bar";

  const option = useMemo<EChartsOption>(() => {
    const categories = data.map((d) => d.stage);
    const ecSeries = series.map((s) => ({
      name: s.label,
      type: "bar" as const,
      data: data.map((d) => {
        const v = d[s.key];
        return typeof v === "number" ? v : null;
      }),
      itemStyle: { color: s.color },
    }));

    return themed(
      {
        tooltip: { trigger: "axis" },
        legend: series.length > 1 ? { type: "scroll", top: 0 } : undefined,
        xAxis: { type: "category", data: categories },
        yAxis: {
          type: "value",
          ...(yLabel ? { name: yLabel, nameLocation: "middle", nameGap: 40 } : {}),
        },
        grid: { left: 56, right: 24, top: series.length > 1 ? 56 : 24, bottom: 32 },
        series: ecSeries,
      },
      tokens,
    );
  }, [data, series, yLabel, tokens]);

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
