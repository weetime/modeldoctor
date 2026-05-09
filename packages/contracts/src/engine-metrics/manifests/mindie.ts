import type { EngineManifest, EngineMetricSpec } from "../../engine-metrics.js";

// `${M}` is the literal placeholder string `${model}` — service.fetchSnapshot
// does the runtime substitution.
const M = "${model}";

const metrics: EngineMetricSpec[] = [
  {
    key: "active_requests",
    group: "topline",
    panel: "gauge",
    unit: "count",
    promql: [{ tag: "v1", expr: `sum(mindie_running_request_count{model_name="${M}"})` }],
  },
  {
    key: "ttft_p99",
    group: "topline",
    panel: "stat",
    unit: "ms",
    promql: [
      {
        tag: "v1",
        expr: `histogram_quantile(0.99, sum by (le) (rate(mindie_first_token_duration_seconds_bucket{model_name="${M}"}[5m]))) * 1000`,
      },
    ],
  },
  {
    key: "e2e_latency",
    group: "latency",
    panel: "timeseries",
    unit: "ms",
    promql: [
      {
        tag: "v1",
        expr:
          `label_replace(histogram_quantile(0.50, sum by (le) (rate(mindie_request_duration_seconds_bucket{model_name="${M}"}[1m]))) * 1000, "series", "p50", "", ".*")` +
          ` or label_replace(histogram_quantile(0.95, sum by (le) (rate(mindie_request_duration_seconds_bucket{model_name="${M}"}[1m]))) * 1000, "series", "p95", "", ".*")` +
          ` or label_replace(histogram_quantile(0.99, sum by (le) (rate(mindie_request_duration_seconds_bucket{model_name="${M}"}[1m]))) * 1000, "series", "p99", "", ".*")`,
      },
    ],
  },
  {
    key: "token_throughput_out",
    group: "throughput",
    panel: "timeseries",
    unit: "tps",
    promql: [
      { tag: "v1", expr: `sum(rate(mindie_generation_tokens_total{model_name="${M}"}[1m]))` },
    ],
  },
  {
    key: "kv_cache_usage",
    group: "engine",
    panel: "timeseries",
    unit: "%",
    promql: [
      {
        tag: "v1",
        expr: `clamp_max(100, 100 * mindie_kv_cache_usage_ratio{model_name="${M}"})`,
      },
    ],
  },
];

export const mindieManifest: EngineManifest = {
  engineId: "mindie",
  capability: "generative",
  displayName: "MindIE",
  metrics,
};
