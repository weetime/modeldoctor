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
 * Reduce a live engine-metrics snapshot (per-metric time-series over the run
 * window) to durable scalars: `avg` (window mean) + `peak` (window max) for
 * each selected metric. Unavailable / empty panels are dropped. The frontend
 * picks avg vs peak per metric (peak for kv-cache / queue saturation, avg for
 * rates). `capturedAt` is the snapshot window end.
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
    let sum = 0;
    let count = 0;
    let peak = Number.NEGATIVE_INFINITY;
    for (const series of panel.series) {
      for (const [, value] of series.samples) {
        if (!Number.isFinite(value)) continue;
        sum += value;
        count += 1;
        if (value > peak) peak = value;
      }
    }
    if (count === 0) continue;
    metrics.push({ key, unit: panel.unit, avg: sum / count, peak });
  }
  return { capturedAt: resp.window.to, metrics };
}
