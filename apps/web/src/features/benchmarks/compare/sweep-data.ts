import type {
  FigureRefId,
  SweepMetricKey,
  SweepRunInput,
  SweepSeries,
} from "@modeldoctor/contracts";
import { readMetricSafe } from "@modeldoctor/tool-adapters/schemas";
import type { SweepLineSeries } from "../../../components/charts/SweepLineChart";
import { readEngineMetric } from "./client-metrics";

/** Minimal per-run shape buildSweepRuns needs (subset of ReportRun) — avoids a
 * type cycle with ReportSections while staying structurally compatible. */
export interface SweepRunSource {
  x?: number;
  series?: { key: string; label: string };
  summaryMetrics: unknown;
  serverMetrics?: unknown;
}

/** Extract each run's sweep metrics (client mirror of the server extractor).
 * Runs without an x value or series identity are dropped — they can't sit on a
 * sweep axis. Throughput is output tok/s (the headline metric); rps kept too. */
export function buildSweepRuns(runs: SweepRunSource[]): SweepRunInput[] {
  const out: SweepRunInput[] = [];
  for (const r of runs) {
    if (typeof r.x !== "number" || !r.series) continue;
    const sm = r.summaryMetrics;
    const num = (kind: Parameters<typeof readMetricSafe>[0]): number | null => {
      const v = readMetricSafe(kind, sm as { tool?: unknown; data?: unknown } | null);
      return typeof v === "number" ? v : null;
    };
    const kv = readEngineMetric(r.serverMetrics, "kv_cache_usage");
    const queue = readEngineMetric(r.serverMetrics, "scheduler_waiting");
    out.push({
      seriesKey: r.series.key,
      seriesLabel: r.series.label,
      x: r.x,
      metrics: {
        outTps: num("outputTokensPerSec"),
        rps: num("requestsPerSec"),
        ttftP50: num("ttft.p50"),
        ttftP95: num("ttft.p95"),
        itlP50: num("itl.p50"),
        e2eP50: num("e2e.p50"),
        kvAvg: kv?.avg ?? null,
        queueDepth: queue?.avg ?? null,
      },
    });
  }
  return out;
}

/** Each sweep figure → the primary metric it plots (sweep-ttft adds a p95
 * dashed line, handled in the renderer). */
export const SWEEP_FIGURE_METRIC: Record<
  "sweep-throughput" | "sweep-ttft" | "sweep-itl" | "sweep-e2e" | "sweep-kv-cache" | "sweep-queue",
  SweepMetricKey
> = {
  "sweep-throughput": "outTps",
  "sweep-ttft": "ttftP50",
  "sweep-itl": "itlP50",
  "sweep-e2e": "e2eP50",
  "sweep-kv-cache": "kvAvg",
  "sweep-queue": "queueDepth",
};

/** A sweep figure is renderable when ≥2 series each carry ≥2 points for that
 * metric (a single point or a single series isn't a curve worth a line chart). */
export function availableSweepFigures(series: SweepSeries[]): Set<FigureRefId> {
  const out = new Set<FigureRefId>();
  const seriesWith = (metric: SweepMetricKey) =>
    series.filter((s) => s.points.filter((p) => typeof p.values[metric] === "number").length >= 2)
      .length;
  for (const [refId, metric] of Object.entries(SWEEP_FIGURE_METRIC)) {
    if (seriesWith(metric) >= 2) out.add(refId as FigureRefId);
  }
  return out;
}

/** Map aggregated sweep series → SweepLineChart series for one metric, assigning
 * each series its identity color. `secondaryMetric` adds a dashed line (p95). */
export function toSweepLineSeries(
  series: SweepSeries[],
  metric: SweepMetricKey,
  colorFor: (seriesKey: string) => string,
  secondaryMetric?: SweepMetricKey,
): SweepLineSeries[] {
  return series.map((s) => ({
    label: s.seriesLabel,
    color: colorFor(s.seriesKey),
    points: s.points.map((p) => ({ x: p.x, y: p.values[metric] ?? null })),
    secondary: secondaryMetric
      ? s.points.map((p) => ({ x: p.x, y: p.values[secondaryMetric] ?? null }))
      : undefined,
  }));
}
