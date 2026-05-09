import type { PanelUnit } from "@modeldoctor/contracts";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { ChartFrame, themed, useChartTokens } from "./_shared";
import { formatPanelValue } from "./format-unit";

export interface BarChartSeries {
  name: string;
  samples: Array<[number, number]>; // [unixSeconds, value]
  color?: string;
}

export interface BarChartProps {
  ariaLabel: string;
  series: BarChartSeries[];
  unit: PanelUnit;
  /** When set, all series share this stack id (stacked bars). When undefined, bars are grouped side-by-side. */
  stack?: string;
  loading?: boolean;
  empty?: boolean | string;
  height?: number;
}

export function BarChart({
  ariaLabel,
  series,
  unit,
  stack,
  loading,
  empty,
  height = 280,
}: BarChartProps): JSX.Element {
  const tokens = useChartTokens();
  const isEmpty = empty ?? (series.length === 0 || series.every((s) => s.samples.length === 0));

  const option = useMemo<EChartsOption>(() => {
    const ecSeries = series.map((s) => ({
      name: s.name,
      type: "bar" as const,
      data: s.samples.map(([t, v]) => [t * 1000, v]),
      ...(stack !== undefined ? { stack } : {}),
      ...(s.color ? { itemStyle: { color: s.color } } : {}),
    }));

    return themed(
      {
        tooltip: {
          trigger: "axis",
          valueFormatter: (v: unknown) =>
            typeof v === "number" ? formatPanelValue(v, unit) : String(v),
        },
        legend: { type: "scroll", top: 0 },
        xAxis: { type: "time" },
        yAxis: { type: "value" },
        grid: { left: 56, right: 24, top: 56, bottom: 32 },
        series: ecSeries,
      },
      tokens,
    );
  }, [series, unit, stack, tokens]);

  return (
    <ChartFrame ariaLabel={ariaLabel} height={height} loading={loading} empty={isEmpty}>
      <ReactECharts option={option} style={{ height: "100%", width: "100%" }} notMerge lazyUpdate />
    </ChartFrame>
  );
}
