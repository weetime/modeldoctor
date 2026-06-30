import type { FigureRefId } from "./compare-narrative.js";

// Pure sweep aggregation: group benchmark runs into series (by connection) over
// a swept x-axis (concurrency), taking the median per (series, x) cell across
// repeats. Metric EXTRACTION (reading summaryMetrics / serverMetrics) stays in
// the per-side readers (api metrics.ts / web client-metrics.ts) which already
// differ; this module only owns the shared grouping+median so both sides agree.

/** Metric keys a sweep can plot vs the x-axis. Latency in ms, throughput in
 * tok/s or req/s, kv in %, queueDepth = scheduler waiting count. */
export const SWEEP_METRIC_KEYS = [
  "outTps",
  "rps",
  "ttftP50",
  "ttftP95",
  "itlP50",
  "e2eP50",
  "e2eP95",
  "kvAvg",
  "kvPeak",
  "queueDepth",
] as const;
export type SweepMetricKey = (typeof SWEEP_METRIC_KEYS)[number];

export type SweepMetricValues = Partial<Record<SweepMetricKey, number | null>>;

/** One run's contribution to a sweep, after the caller extracted its metrics. */
export interface SweepRunInput {
  /** Stable series identity — connectionId (falls back to engineKind/label). */
  seriesKey: string;
  /** Display label for the series (engine kind, e.g. "vLLM-Ascend"). */
  seriesLabel: string;
  /** x-axis value for this run (e.g. params.parallel). */
  x: number;
  metrics: SweepMetricValues;
}

export interface SweepPoint {
  x: number;
  /** repeats collapsed to the per-metric median; null when no run had it. */
  values: SweepMetricValues;
  /** how many repeats fed this point (per the densest metric). */
  n: number;
}

export interface SweepSeries {
  seriesKey: string;
  seriesLabel: string;
  points: SweepPoint[]; // sorted ascending by x
}

/** Median of finite numbers; null when empty. Average of the two middles for
 * even counts. Does not mutate the input. */
export function median(nums: number[]): number | null {
  const xs = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 0 ? (xs[mid - 1] + xs[mid]) / 2 : xs[mid];
}

/** Group runs by series, then by x; median each metric across repeats in a cell.
 * Series are returned in first-seen order; points are sorted ascending by x. */
export function aggregateSweep(runs: SweepRunInput[]): SweepSeries[] {
  // Map preserves insertion order → series come out in first-seen order with
  // no index bookkeeping (and no non-null assertions).
  const bySeries = new Map<string, { label: string; byX: Map<number, SweepRunInput[]> }>();

  for (const r of runs) {
    let s = bySeries.get(r.seriesKey);
    if (!s) {
      s = { label: r.seriesLabel, byX: new Map() };
      bySeries.set(r.seriesKey, s);
    }
    const cell = s.byX.get(r.x);
    if (cell) cell.push(r);
    else s.byX.set(r.x, [r]);
  }

  const series: SweepSeries[] = [];
  for (const [seriesKey, s] of bySeries) {
    const points: SweepPoint[] = [...s.byX.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([x, cell]) => {
        const values: SweepMetricValues = {};
        let n = 0;
        for (const key of SWEEP_METRIC_KEYS) {
          const present = cell
            .map((r) => r.metrics[key])
            .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
          values[key] = median(present);
          n = Math.max(n, present.length);
        }
        return { x, values, n };
      });
    series.push({ seriesKey, seriesLabel: s.label, points });
  }
  return series;
}

/** Each sweep figure refId → the primary metric it plots. sweep-ttft also draws
 * a p95 dashed line (handled in the renderer). Shared client↔server so the
 * availability gate + offered-to-LLM list + renderer all agree. */
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

/** A sweep figure is renderable when ≥2 series each carry ≥2 points for its
 * metric (a single point or single series isn't a curve worth a line chart). */
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
