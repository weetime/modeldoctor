import type { EngineManifest, EngineMetricSpec } from "../../engine-metrics.js";

// `${M}` is the literal placeholder string `${model}` — service.fetchSnapshot
// does the runtime substitution. The constant keeps multi-line PromQL readable.
// biome-ignore lint/suspicious/noTemplateCurlyInString: PromQL template variable, not a JS expression
const M = "${model}";

const metrics: EngineMetricSpec[] = [
  {
    key: "active_requests",
    unit: "count",
    promql: [{ tag: "v1", expr: `sum(sglang:num_running_reqs{model_name="${M}"})` }],
  },
  {
    key: "ttft_p99",
    unit: "ms",
    promql: [
      {
        tag: "v1",
        expr: `histogram_quantile(0.99, sum by (le) (rate(sglang:time_to_first_token_seconds_bucket{model_name="${M}"}[5m]))) * 1000`,
      },
    ],
  },
  {
    key: "success_rate",
    unit: "ratio",
    promql: [
      {
        tag: "v1",
        expr: `sum(rate(sglang:request_success_total{model_name="${M}"}[5m])) / clamp_min(sum(rate(sglang:request_total{model_name="${M}"}[5m])), 1)`,
      },
    ],
    thresholds: [
      { at: 0.95, severity: "ok" },
      { at: 0.9, severity: "warn" },
      { at: 0, severity: "crit" },
    ],
  },
  {
    key: "e2e_latency",
    unit: "ms",
    promql: [
      {
        tag: "v1",
        expr:
          `label_replace(histogram_quantile(0.50, sum by (le) (rate(sglang:e2e_request_latency_seconds_bucket{model_name="${M}"}[1m]))) * 1000, "series", "p50", "", ".*")` +
          ` or label_replace(histogram_quantile(0.95, sum by (le) (rate(sglang:e2e_request_latency_seconds_bucket{model_name="${M}"}[1m]))) * 1000, "series", "p95", "", ".*")` +
          ` or label_replace(histogram_quantile(0.99, sum by (le) (rate(sglang:e2e_request_latency_seconds_bucket{model_name="${M}"}[1m]))) * 1000, "series", "p99", "", ".*")`,
      },
    ],
  },
  {
    key: "token_throughput_out",
    unit: "tps",
    promql: [{ tag: "v1", expr: `sum(sglang:gen_throughput{model_name="${M}"})` }],
  },
  {
    key: "request_queue_time",
    unit: "count",
    promql: [{ tag: "v1", expr: `sum(sglang:num_queue_reqs{model_name="${M}"})` }],
  },
  {
    key: "kv_cache_usage",
    unit: "%",
    promql: [
      {
        tag: "v1",
        expr: `clamp_max(100, 100 * sglang:token_usage{model_name="${M}"})`,
      },
    ],
  },
  {
    key: "scheduler_state",
    unit: "count",
    promql: [
      {
        tag: "v1",
        expr:
          `label_replace(sum(sglang:num_running_reqs{model_name="${M}"}), "series", "running", "", ".*")` +
          ` or label_replace(sum(sglang:num_queue_reqs{model_name="${M}"}), "series", "waiting", "", ".*")`,
      },
    ],
  },
  {
    key: "finish_reason",
    unit: "rps",
    promql: [
      {
        tag: "v1",
        expr: `sum by (finished_reason) (rate(sglang:request_success_total{model_name="${M}"}[1m]))`,
      },
    ],
  },
];

export const sglangManifest: EngineManifest = {
  engineId: "sglang",
  capability: "generative",
  displayName: "SGLang",
  metrics,
};
