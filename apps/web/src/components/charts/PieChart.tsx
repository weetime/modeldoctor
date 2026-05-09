import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { ChartFrame, themed, useChartTokens } from "./_shared";

export interface PieDatum {
  name: string;
  value: number;
  color?: string;
}

export interface PieChartProps {
  ariaLabel: string;
  data: PieDatum[];
  loading?: boolean;
  empty?: boolean | string;
  height?: number;
}

export function PieChart({
  ariaLabel,
  data,
  loading,
  empty,
  height = 280,
}: PieChartProps): JSX.Element {
  const tokens = useChartTokens();
  const isEmpty = empty ?? (data.length === 0 || data.every((d) => d.value === 0));

  const option = useMemo<EChartsOption>(() => {
    return themed(
      {
        tooltip: {
          trigger: "item",
          formatter: "{b}: {c} ({d}%)",
        },
        series: [
          {
            type: "pie",
            radius: ["40%", "70%"],
            label: { show: true, position: "outside" },
            data: data.map((d) => ({
              name: d.name,
              value: d.value,
              ...(d.color ? { itemStyle: { color: d.color } } : {}),
            })),
          },
        ],
      },
      tokens,
    );
  }, [data, tokens]);

  return (
    <ChartFrame ariaLabel={ariaLabel} height={height} loading={loading} empty={isEmpty}>
      <ReactECharts option={option} style={{ height: "100%", width: "100%" }} notMerge lazyUpdate />
    </ChartFrame>
  );
}
