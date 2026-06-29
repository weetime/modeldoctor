import type {
  EngineMetricsAnnotation,
  EngineMetricsSnapshotResponse,
} from "@modeldoctor/contracts";

/**
 * The subset of engine-metric manifest keys we snapshot into
 * `serverMetrics.engineMetrics` at benchmark completion and surface in
 * compare (key-metrics table + cross-run bars). Kept small + cross-run
 * meaningful — full time-series stay live on the detail-page tab.
 */
export const COMPARE_ENGINE_METRIC_KEYS = [
  "success_rate",
  "system_efficiency",
  "ttft_p99",
  "preemption_rate",
  "kv_cache_usage",
  "prefix_cache_hit_rate",
  "request_queue_time",
] as const;

/**
 * Saturation thresholds (in the metric's own unit) for metrics where "how long
 * it stayed pinned" matters more than the bare peak. `satFrac` = fraction of
 * window samples ≥ threshold. KV cache usage is reported in % (0..100), so the
 * 90% saturation line is `90`, not `0.9`.
 */
const SATURATION_THRESHOLD: Record<string, number> = {
  kv_cache_usage: 90,
};

/**
 * The `scheduler_state` manifest panel bundles three series (running / waiting
 * / swapped, tagged via the `series` label). We snapshot only `waiting` — the
 * request-backlog signal — as a standalone durable scalar so the report can
 * pair queue *time* (request_queue_time, ms) with queue *depth* (count).
 */
const SCHEDULER_STATE_KEY = "scheduler_state";
const SCHEDULER_WAITING_KEY = "scheduler_waiting";

interface SeriesStats {
  avg: number;
  peak: number;
  satFrac: number | null;
}

/** Reduce a set of series' samples to avg/peak (+ optional saturation
 * fraction). Returns null when no finite samples are present. */
function reduceSamples(
  seriesList: { samples: [number, number][] }[],
  threshold: number | undefined,
): SeriesStats | null {
  let sum = 0;
  let count = 0;
  let peak = Number.NEGATIVE_INFINITY;
  let saturated = 0;
  for (const series of seriesList) {
    for (const [, value] of series.samples) {
      if (!Number.isFinite(value)) continue;
      sum += value;
      count += 1;
      if (value > peak) peak = value;
      if (threshold !== undefined && value >= threshold) saturated += 1;
    }
  }
  if (count === 0) return null;
  return {
    avg: sum / count,
    peak,
    satFrac: threshold === undefined ? null : saturated / count,
  };
}

/**
 * Reduce a live engine-metrics snapshot (per-metric time-series over the run
 * window) to durable scalars: `avg` (window mean) + `peak` (window max) for
 * each selected metric, plus `satFrac` (fraction of the window at/above the
 * saturation threshold) for metrics that define one. Unavailable / empty panels
 * are dropped. The frontend picks avg vs peak per metric (peak for kv-cache /
 * queue saturation, avg for rates). Additionally extracts the `waiting` series
 * from the `scheduler_state` panel as a standalone `scheduler_waiting` scalar.
 * `capturedAt` is the snapshot window end.
 */
export function reduceEngineSnapshot(
  resp: EngineMetricsSnapshotResponse,
  keys: readonly string[] = COMPARE_ENGINE_METRIC_KEYS,
): EngineMetricsAnnotation {
  const byKey = new Map(resp.panels.map((p) => [p.key, p]));
  const metrics: EngineMetricsAnnotation["metrics"] = [];
  for (const key of keys) {
    const panel = byKey.get(key);
    if (!panel || panel.unavailable) continue;
    const stats = reduceSamples(panel.series, SATURATION_THRESHOLD[key]);
    if (!stats) continue;
    metrics.push({
      key,
      unit: panel.unit,
      avg: stats.avg,
      peak: stats.peak,
      satFrac: stats.satFrac,
    });
  }

  // scheduler_state → scheduler_waiting (waiting series only). vLLM/MindIE
  // expose running/waiting/swapped; SGLang lacks swapped but still has waiting.
  const schedPanel = byKey.get(SCHEDULER_STATE_KEY);
  if (schedPanel && !schedPanel.unavailable) {
    const waiting = schedPanel.series.filter((s) => s.label === "waiting");
    const stats = reduceSamples(waiting, undefined);
    if (stats) {
      metrics.push({
        key: SCHEDULER_WAITING_KEY,
        unit: schedPanel.unit,
        avg: stats.avg,
        peak: stats.peak,
      });
    }
  }

  return { capturedAt: resp.window.to, metrics };
}
