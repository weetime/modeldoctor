import { themed, useChartTokens } from "@/components/charts/_shared";
import type { EngineMetricsPanelResult } from "@modeldoctor/contracts";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export interface HeatmapPanelProps {
  label: string;
  series: EngineMetricsPanelResult["series"];
  unavailable: boolean;
  reason?: EngineMetricsPanelResult["reason"];
}

export function HeatmapPanel({ label, series, unavailable, reason }: HeatmapPanelProps) {
  const { t } = useTranslation("engine-metrics");
  const tokens = useChartTokens();

  const option = useMemo<EChartsOption>(
    () =>
      themed(
        {
          tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
          legend: { type: "scroll", top: 0 },
          xAxis: { type: "time" },
          yAxis: { type: "value", name: "count" },
          grid: { left: 48, right: 16, top: 32, bottom: 32 },
          series: series.map((s, i) => ({
            name: s.label ?? `bucket-${i}`,
            type: "bar",
            stack: "hist",
            barCategoryGap: "0%",
            data: s.samples.map(([t, v]) => [t * 1000, v]),
          })),
        },
        tokens,
      ),
    [series, tokens],
  );

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      {unavailable || series.length === 0 ? (
        <div className="mt-2 text-sm italic text-muted-foreground">
          {t(`unavailable.${reason ?? "noData"}`, { defaultValue: t("unavailable.noData") })}
        </div>
      ) : (
        <ReactECharts option={option} style={{ height: 220, width: "100%" }} notMerge lazyUpdate />
      )}
    </div>
  );
}
