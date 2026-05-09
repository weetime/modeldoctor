import {
  BarChartPanel,
  type BarChartSeries,
  Gauge,
  LineTimeseries,
  type LineTimeseriesSeries,
  Stat,
} from "@/components/charts";
import type { EngineMetricsPanelResult, EngineMetricsSeries } from "@modeldoctor/contracts";
import { ENGINE_DISPLAY_NAME } from "@modeldoctor/contracts";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type Group, vizFor } from "./metric-viz.js";
import { useEngineMetrics } from "./useEngineMetrics.js";

export interface EngineMetricsSectionProps {
  connectionId: string;
  /** ISO datetime — benchmark startedAt */
  startedAt: string;
  /** ISO datetime — benchmark finishedAt */
  finishedAt: string;
}

const GROUP_ORDER: Group[] = ["topline", "latency", "throughput", "engine", "health"];

const GROUP_GRID_CLASS: Record<Group, string> = {
  topline: "grid-cols-1 md:grid-cols-2 lg:grid-cols-5",
  latency: "grid-cols-1 md:grid-cols-3",
  throughput: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
  engine: "grid-cols-1 md:grid-cols-3",
  health: "grid-cols-1 md:grid-cols-3",
};

function shiftIso(iso: string, deltaSeconds: number): string {
  return new Date(new Date(iso).getTime() + deltaSeconds * 1000).toISOString();
}

function toLineSeries(series: readonly EngineMetricsSeries[]): LineTimeseriesSeries[] {
  return series.map((s, i) => ({
    name: s.label ?? `series-${i}`,
    samples: s.samples,
  }));
}

function toBarSeries(series: readonly EngineMetricsSeries[]): BarChartSeries[] {
  return series.map((s, i) => ({
    name: s.label ?? `bucket-${i}`,
    samples: s.samples,
  }));
}

function latestValue(series: readonly EngineMetricsSeries[]): number | null {
  const last = series.flatMap((s) => s.samples).at(-1);
  return last?.[1] ?? null;
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

  // Bucket panels by frontend-decided group.
  const byGroup: Record<Group, EngineMetricsPanelResult[]> = {
    topline: [],
    latency: [],
    throughput: [],
    engine: [],
    health: [],
  };
  for (const p of data.panels) byGroup[vizFor(p.key).group].push(p);

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
        // Topline + engine groups are the most actionable for compact
        // benchmark detail viewing — keep them open by default. Latency /
        // throughput / health collapse to keep the page scannable.
        const defaultOpen = group === "topline" || group === "engine";
        return (
          <details
            key={group}
            open={defaultOpen}
            className="group rounded-md border border-border bg-card/40"
          >
            <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-accent/40">
              <span
                aria-hidden
                className="inline-block transition-transform duration-150 group-open:rotate-90"
              >
                ▸
              </span>
              <span>{t(`groups.${group}`)}</span>
              <span className="ml-auto text-[10px] font-normal opacity-70">
                {panels.length}
              </span>
            </summary>
            <div className={`grid gap-3 px-3 pb-3 pt-1 ${GROUP_GRID_CLASS[group]}`}>
              {panels.map((panel) => (
                <PanelCard key={panel.key} panel={panel} window={benchmarkWindow} />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

interface PanelCardProps {
  panel: EngineMetricsPanelResult;
  window: { from: number; to: number };
}

function PanelCard({ panel, window: w }: PanelCardProps) {
  const { t } = useTranslation("engine-metrics");
  const viz = vizFor(panel.key);
  const label = t(`metrics.${panel.key}.label`, { defaultValue: panel.key });
  const emptyText: boolean | string = panel.unavailable
    ? t(`unavailable.${panel.reason ?? "noData"}`, {
        defaultValue: t("unavailable.noData"),
      })
    : false;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 text-xs text-muted-foreground">{label}</div>
      {viz.kind === "stat" && (
        <Stat
          ariaLabel={label}
          value={latestValue(panel.series)}
          unit={panel.unit}
          thresholds={panel.thresholds}
          empty={emptyText}
        />
      )}
      {viz.kind === "gauge" && (
        <Gauge
          ariaLabel={label}
          value={latestValue(panel.series)}
          unit={panel.unit}
          max={viz.gaugeMax}
          empty={emptyText}
        />
      )}
      {viz.kind === "line" && (
        <LineTimeseries
          ariaLabel={label}
          series={toLineSeries(panel.series)}
          unit={panel.unit}
          markArea={w}
          empty={emptyText}
        />
      )}
      {viz.kind === "bar" && (
        <BarChartPanel
          ariaLabel={label}
          series={toBarSeries(panel.series)}
          unit={panel.unit}
          stack={viz.barStack}
          empty={emptyText}
        />
      )}
    </div>
  );
}
