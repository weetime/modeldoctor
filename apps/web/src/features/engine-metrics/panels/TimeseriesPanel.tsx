import { themed, useChartTokens } from "@/components/charts/_shared";
import type { EngineMetricsPanelResult, PanelUnit } from "@modeldoctor/contracts";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatPanelValue } from "./format-unit.js";

export interface TimeseriesPanelProps {
  label: string;
  unit: PanelUnit;
  series: EngineMetricsPanelResult["series"];
  unavailable: boolean;
  reason?: EngineMetricsPanelResult["reason"];
  /** unix seconds — actual benchmark window highlighted on top of the chart */
  benchmarkWindow: { from: number; to: number };
}

export function TimeseriesPanel({
  label,
  unit,
  series,
  unavailable,
  reason,
  benchmarkWindow,
}: TimeseriesPanelProps) {
  const { t } = useTranslation("engine-metrics");
  const tokens = useChartTokens();

  const option = useMemo<EChartsOption>(
    () =>
      themed(
        {
          tooltip: {
            trigger: "axis",
            valueFormatter: (v) =>
              typeof v === "number" ? formatPanelValue(v, unit) : String(v),
          },
          legend: {
            data: series.map((s, i) => s.label ?? `series-${i}`),
            type: "scroll",
            top: 0,
          },
          xAxis: { type: "time" },
          yAxis: { type: "value" },
          grid: { left: 48, right: 16, top: 32, bottom: 32 },
          series: series.map((s, i) => ({
            name: s.label ?? `series-${i}`,
            type: "line",
            showSymbol: false,
            sampling: "lttb",
            data: s.samples.map(([t, v]) => [t * 1000, v]),
            lineStyle: { width: 1.5 },
            ...(i === 0
              ? {
                  markArea: {
                    silent: true,
                    itemStyle: { color: "rgba(99, 102, 241, 0.10)" },
                    data: [
                      [
                        { xAxis: benchmarkWindow.from * 1000 },
                        { xAxis: benchmarkWindow.to * 1000 },
                      ],
                    ],
                  },
                }
              : {}),
          })),
        },
        tokens,
      ),
    [series, unit, benchmarkWindow, tokens],
  );

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      {unavailable || series.length === 0 ? (
        <div className="mt-2 text-sm italic text-muted-foreground">
          {t(`unavailable.${reason ?? "noData"}`, { defaultValue: t("unavailable.noData") })}
        </div>
      ) : (
        <ReactECharts
          option={option}
          style={{ height: 220, width: "100%" }}
          notMerge
          lazyUpdate
        />
      )}
    </div>
  );
}
