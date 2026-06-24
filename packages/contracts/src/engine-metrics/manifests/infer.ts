import type { EngineManifest, EngineMetricSpec } from "../../engine-metrics.js";

// Normalized manifest: queries the `infer:*` Prometheus recording rules
// (deploy/k8s/prometheus-rules) instead of raw per-engine metrics. The
// recording rules absorb every engine/version difference (vLLM V0/V1, SGLang,
// TGI, …) and emit one stable `infer:*` namespace keyed by (instance,
// model_name, engine). So a SINGLE manifest serves all engines — no more
// per-engine PromQL, no clamp_max-style transcription bugs.
//
// Aggregation here collapses the per-instance recording-rule series down to a
// model-wide view: avg() for ratios/percentiles, sum() for counts/rates.
// Percentiles are ALREADY computed by the rules (no histogram_quantile).
//
// biome-ignore lint/suspicious/noTemplateCurlyInString: PromQL template variable, not a JS expression
const M = "${model}";

const metrics: EngineMetricSpec[] = [
  // ---- topline ----
  {
    key: "success_rate",
    unit: "ratio",
    promql: [{ expr: `avg(infer:request:success_ratio{model_name="${M}"})` }],
  },
  {
    key: "active_requests",
    unit: "count",
    promql: [{ expr: `sum(infer:request:running{model_name="${M}"})` }],
  },
  {
    key: "system_efficiency",
    unit: "ratio",
    promql: [
      {
        expr: `sum(infer:throughput:generation_rate_tps{model_name="${M}"}) / clamp_min(sum(rate(infer:throughput:prompt_tokens_total{model_name="${M}"}[1m])), 1)`,
      },
    ],
  },
  {
    key: "ttft_p99",
    unit: "ms",
    promql: [{ expr: `avg(infer:request:ttft_seconds:p99{model_name="${M}"}) * 1000` }],
  },
  {
    key: "preemption_rate",
    unit: "rps",
    promql: [{ expr: `sum(rate(infer:request:preempted_total{model_name="${M}"}[1m]))` }],
  },
  // ---- latency ----
  {
    key: "e2e_latency",
    unit: "ms",
    promql: [
      {
        expr: `label_replace(avg(infer:request:e2e_seconds:p95{model_name="${M}"}) * 1000, "series", "p95", "", ".*") or label_replace(avg(infer:request:e2e_seconds:p99{model_name="${M}"}) * 1000, "series", "p99", "", ".*")`,
      },
    ],
  },
  {
    key: "stage_breakdown",
    unit: "ms",
    promql: [
      {
        expr: `label_replace(avg(infer:request:prefill_seconds:avg{model_name="${M}"}) * 1000, "series", "prefill", "", ".*") or label_replace(avg(infer:request:decode_seconds:avg{model_name="${M}"}) * 1000, "series", "decode", "", ".*")`,
      },
    ],
  },
  {
    key: "ttft_vs_tpot",
    unit: "ms",
    promql: [
      {
        expr: `label_replace(avg(infer:request:ttft_seconds:p99{model_name="${M}"}) * 1000, "series", "ttft_p99", "", ".*") or label_replace(avg(infer:request:tpot_seconds:p99{model_name="${M}"}) * 1000, "series", "tpot_p99", "", ".*")`,
      },
    ],
  },
  // ---- throughput ----
  {
    key: "token_throughput_in",
    unit: "tps",
    promql: [{ expr: `sum(rate(infer:throughput:prompt_tokens_total{model_name="${M}"}[1m]))` }],
  },
  {
    key: "token_throughput_out",
    unit: "tps",
    promql: [{ expr: `sum(infer:throughput:generation_rate_tps{model_name="${M}"})` }],
  },
  {
    key: "token_io_ratio",
    unit: "ratio",
    promql: [
      {
        expr: `sum(infer:throughput:generation_rate_tps{model_name="${M}"}) / clamp_min(sum(rate(infer:throughput:prompt_tokens_total{model_name="${M}"}[1m])), 1)`,
      },
    ],
  },
  {
    key: "prefix_cache_savings",
    unit: "%",
    promql: [{ expr: `100 * avg(infer:cache:prefix_hit_ratio{model_name="${M}"})` }],
  },
  {
    key: "request_queue_time",
    unit: "ms",
    promql: [{ expr: `avg(infer:request:queue_seconds:p95{model_name="${M}"}) * 1000` }],
  },
  // ---- engine ----
  {
    key: "kv_cache_usage",
    unit: "%",
    promql: [{ expr: `clamp_max(100 * avg(infer:cache:kv_usage_ratio{model_name="${M}"}), 100)` }],
  },
  {
    key: "prefix_cache_hit_rate",
    unit: "%",
    promql: [{ expr: `100 * avg(infer:cache:prefix_hit_ratio{model_name="${M}"})` }],
  },
  {
    key: "scheduler_state",
    unit: "count",
    promql: [
      {
        expr: `label_replace(sum(infer:request:running{model_name="${M}"}), "series", "running", "", ".*") or label_replace(sum(infer:request:waiting{model_name="${M}"}), "series", "waiting", "", ".*") or label_replace(sum(infer:request:swapped{model_name="${M}"}), "series", "swapped", "", ".*")`,
      },
    ],
  },
];

export const inferManifest: EngineManifest = {
  engineId: "vllm",
  capability: "generative",
  displayName: "Inference engine (normalized)",
  metrics,
};
