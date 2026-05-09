import type {
  EngineMetricsPanelResult,
  PanelGroup,
} from "@modeldoctor/contracts";
import { ENGINE_DISPLAY_NAME } from "@modeldoctor/contracts";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { GaugePanel } from "./panels/GaugePanel.js";
import { HeatmapPanel } from "./panels/HeatmapPanel.js";
import { StatPanel } from "./panels/StatPanel.js";
import { TimeseriesPanel } from "./panels/TimeseriesPanel.js";
import { useEngineMetrics } from "./useEngineMetrics.js";

export interface EngineMetricsSectionProps {
  connectionId: string;
  startedAt: string; // ISO datetime — benchmark startedAt
  finishedAt: string; // ISO datetime — benchmark finishedAt
}

const GROUP_ORDER: PanelGroup[] = ["topline", "latency", "throughput", "engine", "health"];

const GROUP_GRID_CLASS: Record<PanelGroup, string> = {
  topline: "grid-cols-1 md:grid-cols-2 lg:grid-cols-5",
  latency: "grid-cols-1 md:grid-cols-3",
  throughput: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
  engine: "grid-cols-1 md:grid-cols-3",
  health: "grid-cols-1 md:grid-cols-3",
};

function shiftIso(iso: string, deltaSeconds: number): string {
  return new Date(new Date(iso).getTime() + deltaSeconds * 1000).toISOString();
}

export function EngineMetricsSection({
  connectionId,
  startedAt,
  finishedAt,
}: EngineMetricsSectionProps) {
  const { t } = useTranslation("engine-metrics");

  const range = useMemo(() => {
    const from = shiftIso(startedAt, -30);
    const to = shiftIso(finishedAt, +30);
    const span = (new Date(to).getTime() - new Date(from).getTime()) / 1000;
    const step = Math.max(15, Math.floor(span / 200));
    return { from, to, step };
  }, [startedAt, finishedAt]);

  const benchmarkWindow = useMemo(
    () => ({
      from: Math.floor(new Date(startedAt).getTime() / 1000),
      to: Math.floor(new Date(finishedAt).getTime() / 1000),
    }),
    [startedAt, finishedAt],
  );

  const { data, isLoading, isError } = useEngineMetrics(connectionId, range);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        {t("section.promError")}
      </div>
    );
  }

  const byGroup: Record<PanelGroup, EngineMetricsPanelResult[]> = {
    topline: [],
    latency: [],
    throughput: [],
    engine: [],
    health: [],
  };
  for (const p of data.panels) byGroup[p.group].push(p);

  return (
    <div className="space-y-6">
      <div className="text-xs text-muted-foreground">
        {t("section.subtitle", {
          engineName: ENGINE_DISPLAY_NAME[data.engineId],
          from: data.window.from,
          to: data.window.to,
        })}
      </div>
      {GROUP_ORDER.map((group) => {
        const panels = byGroup[group];
        if (panels.length === 0) return null;
        return (
          <section key={group} className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t(`groups.${group}`)}
            </h4>
            <div className={`grid gap-3 ${GROUP_GRID_CLASS[group]}`}>
              {panels.map((panel) => {
                const label = t(`metrics.${panel.key}.label`, {
                  defaultValue: panel.key,
                });
                if (panel.panel === "stat") {
                  return (
                    <StatPanel
                      key={panel.key}
                      label={label}
                      unit={panel.unit}
                      series={panel.series}
                      unavailable={panel.unavailable}
                      reason={panel.reason}
                    />
                  );
                }
                if (panel.panel === "gauge") {
                  return (
                    <GaugePanel
                      key={panel.key}
                      label={label}
                      unit={panel.unit}
                      series={panel.series}
                      unavailable={panel.unavailable}
                      reason={panel.reason}
                    />
                  );
                }
                if (panel.panel === "heatmap") {
                  return (
                    <HeatmapPanel
                      key={panel.key}
                      label={label}
                      series={panel.series}
                      unavailable={panel.unavailable}
                      reason={panel.reason}
                    />
                  );
                }
                return (
                  <TimeseriesPanel
                    key={panel.key}
                    label={label}
                    unit={panel.unit}
                    series={panel.series}
                    unavailable={panel.unavailable}
                    reason={panel.reason}
                    benchmarkWindow={benchmarkWindow}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
