import type { EngineMetricsPanelResult, EngineMetricsSeries } from "@modeldoctor/contracts";
import { ENGINE_DISPLAY_NAME } from "@modeldoctor/contracts";
import { format } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChartPanel,
  type BarChartSeries,
  Gauge,
  LineTimeseries,
  type LineTimeseriesSeries,
  Stat,
} from "@/components/charts";
import { type Group, vizFor } from "./metric-viz.js";
import { useEngineMetrics } from "./useEngineMetrics.js";

/** How often the live (in-flight) window advances + refetches, in ms. */
const LIVE_REFRESH_MS = 15_000;

export interface EngineMetricsSectionProps {
  connectionId: string;
  /** ISO datetime — benchmark startedAt */
  startedAt: string;
  /**
   * ISO datetime — benchmark finishedAt. Pass `null` for an in-flight run:
   * the window then tracks "now" and refreshes every {@link LIVE_REFRESH_MS}.
   */
  finishedAt: string | null;
}

// Grafana-style 3-section layout:
//   1. KPI       — all Stat panels in one always-visible row
//   2. Gauges    — all Gauge panels in one always-visible row
//   3. Time series — line/bar panels, collapsible per business group
//
// Mixing kinds in the same grid row stretched short cards (Stat h=120) up to
// the row's tallest item (Gauge h=220), leaving big empty gutters. Routing
// panels by kind at the top level eliminates that.
//
// `topline` business group has no time-series — its members are exclusively
// stats/gauges, which now surface in the KPI/Gauges sections regardless of
// their original group annotation.
const TIMESERIES_GROUP_ORDER: Group[] = ["latency", "throughput", "engine", "health"];

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
  const isLive = finishedAt == null;

  // In live mode the upper bound tracks wall-clock "now"; otherwise it's the
  // fixed benchmark end. `nowMs` ticks on the refresh cadence so the derived
  // window (and the query key) only advance once per interval.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNowMs(Date.now()), LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [isLive]);

  const effectiveFinish = useMemo(() => {
    if (finishedAt != null) return finishedAt;
    // Quantize to the refresh cadence so unrelated re-renders don't churn the
    // window — it only steps forward once per LIVE_REFRESH_MS tick.
    const quantized = Math.floor(nowMs / LIVE_REFRESH_MS) * LIVE_REFRESH_MS;
    return new Date(quantized).toISOString();
  }, [finishedAt, nowMs]);

  const range = useMemo(() => {
    const from = shiftIso(startedAt, -30);
    const to = shiftIso(effectiveFinish, +30);
    const span = (new Date(to).getTime() - new Date(from).getTime()) / 1000;
    const step = Math.max(15, Math.floor(span / 200));
    return { from, to, step };
  }, [startedAt, effectiveFinish]);

  const benchmarkWindow = useMemo(
    () => ({
      from: Math.floor(new Date(startedAt).getTime() / 1000),
      to: Math.floor(new Date(effectiveFinish).getTime() / 1000),
    }),
    [startedAt, effectiveFinish],
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

  // Three-segment layout: top-level partition by chart kind first.
  const stats: EngineMetricsPanelResult[] = [];
  const gauges: EngineMetricsPanelResult[] = [];
  const tsByGroup: Record<Group, EngineMetricsPanelResult[]> = {
    topline: [],
    latency: [],
    throughput: [],
    engine: [],
    health: [],
  };
  for (const p of data.panels) {
    const viz = vizFor(p.key);
    if (viz.kind === "stat") stats.push(p);
    else if (viz.kind === "gauge") gauges.push(p);
    else tsByGroup[viz.group].push(p);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {t("section.subtitle", {
            engineName: ENGINE_DISPLAY_NAME[data.engineId],
            from: format(new Date(data.window.from), "yyyy-MM-dd HH:mm:ss"),
            to: format(new Date(data.window.to), "yyyy-MM-dd HH:mm:ss"),
          })}
        </span>
        {isLive && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-500">
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            {t("section.liveBadge")}
          </span>
        )}
      </div>

      {stats.length > 0 && (
        <section className="space-y-3">
          <SectionHeader title={t("sections.kpi")} count={stats.length} />
          {/* auto-fit lets stat cards tile a full row regardless of count —
           * 5 stats in a 1200px row → 5-up; on a 1600px row → still 5-up but
           * each card wider; on a narrow viewport → wraps cleanly. Keeps the
           * Grafana KPI-row look without us hard-coding column counts. */}
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
          >
            {stats.map((panel) => (
              <PanelCard key={panel.key} panel={panel} window={benchmarkWindow} />
            ))}
          </div>
        </section>
      )}

      {gauges.length > 0 && (
        <section className="space-y-3">
          <SectionHeader title={t("sections.gauges")} count={gauges.length} />
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}
          >
            {gauges.map((panel) => (
              <PanelCard key={panel.key} panel={panel} window={benchmarkWindow} />
            ))}
          </div>
        </section>
      )}

      {TIMESERIES_GROUP_ORDER.map((group) => {
        const panels = tsByGroup[group];
        if (panels.length === 0) return null;
        // All time-series groups collapse by default — KPIs + Gauges already
        // surface the at-a-glance state above; the trend blocks are details
        // the user opens on demand.
        return (
          <details key={group} className="group rounded-md border border-border bg-card/40">
            <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-accent/40">
              <span
                aria-hidden
                className="inline-block transition-transform duration-150 group-open:rotate-90"
              >
                ▸
              </span>
              <span>{t(`groups.${group}`)}</span>
              <span className="ml-auto text-[10px] font-normal opacity-70">{panels.length}</span>
            </summary>
            <div className="grid grid-cols-1 gap-3 px-3 pb-3 pt-1 lg:grid-cols-2">
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

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold">
      <span>{title}</span>
      <span className="text-xs font-normal text-muted-foreground">({count})</span>
    </h3>
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
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">{label}</div>
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
