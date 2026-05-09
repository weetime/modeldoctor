import type { EngineManifest, EngineMetricSpec } from "../../engine-metrics.js";

const metrics: EngineMetricSpec[] = [
  {
    key: "active_requests",
    group: "topline",
    panel: "gauge",
    unit: "count",
    promql: [{ tag: "v1", expr: `sum(te_request_count{state="running"})` }],
  },
  {
    key: "success_rate",
    group: "topline",
    panel: "stat",
    unit: "ratio",
    promql: [
      {
        tag: "v1",
        expr: `sum(rate(te_request_count{state="success"}[5m])) / clamp_min(sum(rate(te_request_count{state=~"success|failure"}[5m])), 1)`,
      },
    ],
    thresholds: [
      { at: 0.95, severity: "ok" },
      { at: 0.9, severity: "warn" },
      { at: 0, severity: "crit" },
    ],
  },
  {
    key: "request_latency_p99",
    group: "topline",
    panel: "stat",
    unit: "ms",
    promql: [
      {
        tag: "v1",
        expr: "histogram_quantile(0.99, sum by (le) (rate(te_request_duration_seconds_bucket[5m]))) * 1000",
      },
    ],
  },
  {
    key: "tokenize_rate",
    group: "throughput",
    panel: "timeseries",
    unit: "tps",
    promql: [{ tag: "v1", expr: "sum(rate(te_tokenize_count[1m]))" }],
  },
  {
    key: "embedding_rate",
    group: "throughput",
    panel: "timeseries",
    unit: "rps",
    promql: [{ tag: "v1", expr: `sum(rate(te_request_count{state="success"}[1m]))` }],
  },
  {
    key: "queue_metrics",
    group: "engine",
    panel: "timeseries",
    unit: "ms",
    promql: [
      {
        tag: "v1",
        expr:
          `label_replace(sum(te_queue_size), "series", "queue_size", "", ".*")` +
          ` or label_replace(histogram_quantile(0.99, sum by (le) (rate(te_queue_duration_seconds_bucket[1m]))) * 1000, "series", "queue_p99_ms", "", ".*")`,
      },
    ],
  },
];

export const teiManifest: EngineManifest = {
  engineId: "tei",
  capability: "embedding",
  displayName: "TEI",
  metrics,
};
