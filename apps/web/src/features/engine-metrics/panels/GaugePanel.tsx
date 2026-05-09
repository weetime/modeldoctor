import type { EngineMetricsPanelResult, PanelUnit } from "@modeldoctor/contracts";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { themed, useChartTokens } from "@/components/charts/_shared";
import { formatPanelValue } from "./format-unit.js";

export interface GaugePanelProps {
  label: string;
  unit: PanelUnit;
  series: EngineMetricsPanelResult["series"];
  unavailable: boolean;
  reason?: EngineMetricsPanelResult["reason"];
}

export function GaugePanel({ label, unit, series, unavailable, reason }: GaugePanelProps) {
  const { t } = useTranslation("engine-metrics");
  const tokens = useChartTokens();
  const latest = series.flatMap((s) => s.samples).at(-1);
  const value = latest?.[1] ?? null;

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
              max: unit === "%" ? 100 : Math.max(100, (value ?? 0) * 1.5),
            },
          ],
        },
        tokens,
      ),
    [value, unit, tokens],
  );

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      {unavailable || value == null ? (
        <div className="mt-2 text-sm italic text-muted-foreground">
          {t(`unavailable.${reason ?? "noData"}`, { defaultValue: t("unavailable.noData") })}
        </div>
      ) : (
        <ReactECharts
          option={option}
          style={{ height: 140, width: "100%" }}
          notMerge
          lazyUpdate
        />
      )}
    </div>
  );
}
