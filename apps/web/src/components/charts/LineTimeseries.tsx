import type { PanelUnit } from "@modeldoctor/contracts";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { ChartFrame, themed, useChartTokens } from "./_shared";
import { formatPanelValue } from "./format-unit";

export interface LineTimeseriesSeries {
  name: string;
  samples: Array<[number, number]>; // [unixSeconds, value]
  color?: string; // override palette pick
}

export interface LineTimeseriesProps {
  ariaLabel: string;
  series: LineTimeseriesSeries[];
  unit: PanelUnit;
  /** unix-seconds window highlighted as markArea overlay. */
  markArea?: { from: number; to: number };
  loading?: boolean;
  empty?: boolean | string;
  height?: number;
}

export function LineTimeseries({
  ariaLabel,
  series,
  unit,
  markArea,
  loading,
  empty,
  height = 280,
}: LineTimeseriesProps): JSX.Element {
  const tokens = useChartTokens();
  const isEmpty = empty ?? (series.length === 0 || series.every((s) => s.samples.length === 0));

  const option = useMemo<EChartsOption>(() => {
    const ecSeries = series.map((s, i) => {
      const base = {
        name: s.name,
        type: "line" as const,
        showSymbol: false,
        sampling: "lttb" as const,
        data: s.samples.map(([t, v]) => [t * 1000, v]),
        lineStyle: { width: 2, ...(s.color ? { color: s.color } : {}) },
        ...(s.color ? { itemStyle: { color: s.color } } : {}),
        markArea: undefined as
          | {
              silent: boolean;
              itemStyle: {
                color: string;
                borderColor: string;
                borderWidth: number;
                borderType: "dashed";
              };
              data: [[{ xAxis: number }, { xAxis: number }]];
            }
          | undefined,
      };

      if (i === 0 && markArea) {
        base.markArea = {
          silent: true,
          itemStyle: {
            color: tokens.markAreaColor,
            borderColor: tokens.markAreaBorderColor,
            borderWidth: 1,
            borderType: "dashed",
          },
          data: [[{ xAxis: markArea.from * 1000 }, { xAxis: markArea.to * 1000 }]],
        };
      }

      return base;
    });

    return themed(
      {
        tooltip: {
          trigger: "axis",
          valueFormatter: (v: unknown) =>
            typeof v === "number" ? formatPanelValue(v, unit) : String(v),
        },
        legend: { type: "scroll", top: 0 },
        xAxis: {
          type: "time",
          axisLabel: {
            // Compact HH:mm formatter — full timestamps don't fit on narrow
            // panels and ECharts' default chains date+time without breaks.
            formatter: {
              year: "{yyyy}",
              month: "{MMM}",
              day: "{d}",
              hour: "{HH}:{mm}",
              minute: "{HH}:{mm}",
              second: "{HH}:{mm}:{ss}",
              millisecond: "{HH}:{mm}:{ss}",
            },
          },
        },
        yAxis: {
          type: "value",
          // Mirror the tooltip's unit formatting on the axis labels so byte
          // counts render as KiB/MiB/GiB/TiB instead of raw "1,800,000,000",
          // ms/s carry their unit, ratios/percent show "%" etc.
          axisLabel: {
            formatter: (v: number) => formatPanelValue(v, unit),
          },
        },
        grid: { left: 56, right: 24, top: 56, bottom: 32 },
        series: ecSeries as EChartsOption["series"],
      },
      tokens,
    );
  }, [series, unit, markArea, tokens]);

  return (
    <ChartFrame ariaLabel={ariaLabel} height={height} loading={loading} empty={isEmpty}>
      <ReactECharts option={option} style={{ height: "100%", width: "100%" }} notMerge lazyUpdate />
    </ChartFrame>
  );
}
