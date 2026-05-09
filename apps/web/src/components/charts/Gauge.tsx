import type { PanelUnit } from "@modeldoctor/contracts";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { ChartFrame, themed, useChartTokens } from "./_shared";
import { formatPanelValue } from "./format-unit";

export interface GaugeProps {
  ariaLabel: string;
  value: number | null;
  unit: PanelUnit;
  /** Auto-derived if omitted: % → 100, ratio → 1, count → max(value*1.5, 100). */
  max?: number;
  loading?: boolean;
  empty?: boolean | string;
  height?: number;
}

function deriveMax(unit: PanelUnit, value: number | null, explicitMax?: number): number {
  if (explicitMax != null) return explicitMax;
  if (unit === "%") return 100;
  if (unit === "ratio") return 1;
  return Math.max(100, (value ?? 0) * 1.5);
}

export function Gauge({
  ariaLabel,
  value,
  unit,
  max,
  loading,
  empty,
  height = 160,
}: GaugeProps): JSX.Element {
  const tokens = useChartTokens();
  const isEmpty = empty ?? value == null;
  const derivedMax = deriveMax(unit, value, max);

  const option = useMemo<EChartsOption>(
    () =>
      themed(
        {
          series: [
            {
              type: "gauge",
              progress: { show: true, width: 8 },
              axisLine: { lineStyle: { width: 8 } },
              pointer: { show: false },
              axisTick: { show: false },
              splitLine: { show: false },
              axisLabel: { show: false },
              detail: {
                valueAnimation: false,
                fontSize: 22,
                fontWeight: 600,
                offsetCenter: [0, "0%"],
                formatter: () => formatPanelValue(value, unit),
              },
              data: [{ value: value ?? 0 }],
              min: 0,
              max: derivedMax,
            },
          ],
        },
        tokens,
      ),
    [value, unit, derivedMax, tokens],
  );

  return (
    <ChartFrame ariaLabel={ariaLabel} height={height} loading={loading} empty={isEmpty}>
      <ReactECharts option={option} style={{ height: "100%", width: "100%" }} notMerge lazyUpdate />
    </ChartFrame>
  );
}
