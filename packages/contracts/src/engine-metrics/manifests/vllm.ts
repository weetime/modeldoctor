import type { EngineManifest, EngineMetricSpec } from "../../engine-metrics.js";

// M is the literal placeholder string `${model}` — service.fetchSnapshot
// does the runtime replacement. We assign it once to a constant so the
// surrounding template-literal noise stays readable.
// biome-ignore lint/suspicious/noTemplateCurlyInString: PromQL template variable, not a JS expression
const M = "${model}";

const metrics: EngineMetricSpec[] = [
  // ---- topline ----
  {
    key: "success_rate",
    unit: "ratio",
    promql: [
      {
        tag: "v1",
        // vLLM V1 only emits successful completions (no failure counter); we
        // approximate "success rate" as fraction of completions that ended
        // for a meaningful reason vs aborted/errored.
        expr: `sum(rate(vllm:request_success_total{model_name="${M}",finished_reason!~"abort|error"}[5m])) / clamp_min(sum(rate(vllm:request_success_total{model_name="${M}"}[5m])), 1)`,
      },
    ],
    thresholds: [
      { at: 0.95, severity: "ok" },
      { at: 0.9, severity: "warn" },
      { at: 0, severity: "crit" },
    ],
  },
  {
    key: "active_requests",
    unit: "count",
    promql: [{ tag: "v1", expr: `sum(vllm:num_requests_running{model_name="${M}"})` }],
  },
  {
    key: "system_efficiency",
    unit: "ratio",
    promql: [
      {
        tag: "v1",
        expr: `sum(rate(vllm:generation_tokens_total{model_name="${M}"}[1m])) / clamp_min(sum(rate(vllm:prompt_tokens_total{model_name="${M}"}[1m])), 1)`,
      },
    ],
  },
  {
    key: "ttft_p99",
    unit: "ms",
    promql: [
      {
        tag: "v1",
        expr: `histogram_quantile(0.99, sum by (le) (rate(vllm:time_to_first_token_seconds_bucket{model_name="${M}"}[5m]))) * 1000`,
      },
    ],
  },
  {
    key: "preemption_rate",
    unit: "rps",
    promql: [{ tag: "v1", expr: `sum(rate(vllm:num_preemptions_total{model_name="${M}"}[1m]))` }],
  },
  // ---- latency ----
  {
    key: "e2e_latency",
    unit: "ms",
    promql: [
      {
        tag: "v1",
        expr:
          `label_replace(histogram_quantile(0.50, sum by (le) (rate(vllm:e2e_request_latency_seconds_bucket{model_name="${M}"}[1m]))) * 1000, "series", "p50", "", ".*")` +
          ` or label_replace(histogram_quantile(0.95, sum by (le) (rate(vllm:e2e_request_latency_seconds_bucket{model_name="${M}"}[1m]))) * 1000, "series", "p95", "", ".*")` +
          ` or label_replace(histogram_quantile(0.99, sum by (le) (rate(vllm:e2e_request_latency_seconds_bucket{model_name="${M}"}[1m]))) * 1000, "series", "p99", "", ".*")`,
      },
    ],
  },
  {
    key: "stage_breakdown",
    unit: "ms",
    promql: [
      {
        tag: "v1",
        expr:
          `label_replace((sum(rate(vllm:request_prefill_time_seconds_sum{model_name="${M}"}[1m])) / clamp_min(sum(rate(vllm:request_prefill_time_seconds_count{model_name="${M}"}[1m])), 1)) * 1000, "series", "prefill", "", ".*")` +
          ` or label_replace((sum(rate(vllm:request_decode_time_seconds_sum{model_name="${M}"}[1m])) / clamp_min(sum(rate(vllm:request_decode_time_seconds_count{model_name="${M}"}[1m])), 1)) * 1000, "series", "decode", "", ".*")`,
      },
    ],
  },
  {
    key: "ttft_vs_tpot",
    unit: "ms",
    promql: [
      {
        tag: "v1",
        expr:
          `label_replace(histogram_quantile(0.99, sum by (le) (rate(vllm:time_to_first_token_seconds_bucket{model_name="${M}"}[1m]))) * 1000, "series", "ttft_p99", "", ".*")` +
          ` or label_replace(histogram_quantile(0.99, sum by (le) (rate(vllm:time_per_output_token_seconds_bucket{model_name="${M}"}[1m]))) * 1000, "series", "tpot_p99", "", ".*")`,
      },
    ],
  },
  // ---- throughput ----
  {
    key: "token_throughput_in",
    unit: "tps",
    promql: [{ tag: "v1", expr: `sum(rate(vllm:prompt_tokens_total{model_name="${M}"}[1m]))` }],
  },
  {
    key: "token_throughput_out",
    unit: "tps",
    promql: [
      {
        tag: "v1",
        expr: `sum(rate(vllm:generation_tokens_total{model_name="${M}"}[1m]))`,
      },
    ],
  },
  {
    key: "token_io_ratio",
    unit: "ratio",
    promql: [
      {
        tag: "v1",
        expr: `sum(rate(vllm:generation_tokens_total{model_name="${M}"}[5m])) / clamp_min(sum(rate(vllm:prompt_tokens_total{model_name="${M}"}[5m])), 1)`,
      },
    ],
  },
  {
    key: "prefix_cache_savings",
    unit: "%",
    promql: [
      {
        tag: "v1",
        expr: `100 * sum(rate(vllm:prefix_cache_hits_total{model_name="${M}"}[5m])) / clamp_min(sum(rate(vllm:prefix_cache_queries_total{model_name="${M}"}[5m])), 1)`,
      },
      {
        tag: "v0",
        expr: `100 * sum(rate(vllm:gpu_prefix_cache_hits_total{model_name="${M}"}[5m])) / clamp_min(sum(rate(vllm:gpu_prefix_cache_queries_total{model_name="${M}"}[5m])), 1)`,
      },
    ],
  },
  {
    key: "request_queue_time",
    unit: "ms",
    promql: [
      {
        tag: "v1",
        expr:
          `label_replace(histogram_quantile(0.50, sum by (le) (rate(vllm:request_queue_time_seconds_bucket{model_name="${M}"}[1m]))) * 1000, "series", "p50", "", ".*")` +
          ` or label_replace(histogram_quantile(0.99, sum by (le) (rate(vllm:request_queue_time_seconds_bucket{model_name="${M}"}[1m]))) * 1000, "series", "p99", "", ".*")`,
      },
    ],
  },
  {
    key: "request_length_heatmap",
    unit: "count",
    promql: [
      {
        tag: "v1",
        expr: `sum by (le) (rate(vllm:request_prompt_tokens_bucket{model_name="${M}"}[1m]))`,
      },
    ],
  },
  // ---- engine ----
  {
    key: "kv_cache_usage",
    unit: "%",
    promql: [
      {
        tag: "v1",
        expr: `clamp_max(100, 100 * vllm:kv_cache_usage_perc{model_name="${M}"})`,
      },
      {
        tag: "v0",
        expr: `clamp_max(100, 100 * vllm:gpu_cache_usage_perc{model_name="${M}"})`,
      },
    ],
  },
  {
    key: "prefix_cache_hit_rate",
    unit: "%",
    promql: [
      {
        tag: "v1",
        expr: `100 * sum(rate(vllm:prefix_cache_hits_total{model_name="${M}"}[5m])) / clamp_min(sum(rate(vllm:prefix_cache_queries_total{model_name="${M}"}[5m])), 1)`,
      },
      {
        tag: "v0",
        expr: `100 * sum(rate(vllm:gpu_prefix_cache_hits_total{model_name="${M}"}[5m])) / clamp_min(sum(rate(vllm:gpu_prefix_cache_queries_total{model_name="${M}"}[5m])), 1)`,
      },
    ],
  },
  {
    // Share of prefix-cache queries served by the single busiest pod — the
    // aggregate stand-in for routing stickiness. 100% ⇒ all same-prefix
    // traffic concentrated on one replica (ai-load-balancer prefix routing on).
    key: "prefix_cache_top_pod_share",
    unit: "%",
    promql: [
      {
        tag: "v1",
        expr: `100 * max(sum by (pod) (rate(vllm:prefix_cache_queries_total{model_name="${M}"}[5m]))) / clamp_min(sum(rate(vllm:prefix_cache_queries_total{model_name="${M}"}[5m])), 1)`,
      },
      {
        tag: "v0",
        expr: `100 * max(sum by (pod) (rate(vllm:gpu_prefix_cache_queries_total{model_name="${M}"}[5m]))) / clamp_min(sum(rate(vllm:gpu_prefix_cache_queries_total{model_name="${M}"}[5m])), 1)`,
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
          // V1 vLLM does not expose num_requests_swapped; running + waiting only
          `label_replace(sum(vllm:num_requests_running{model_name="${M}"}), "series", "running", "", ".*")` +
          ` or label_replace(sum(vllm:num_requests_waiting{model_name="${M}"}), "series", "waiting", "", ".*")`,
      },
    ],
  },
  // ---- health ----
  {
    key: "python_gc_memory",
    unit: "bytes",
    promql: [
      {
        tag: "v1",
        // process_resident_memory_bytes is process-level, no model_name label.
        // Match any "infer-*" or "*vllm*" job — most kube deployments scrape
        // vLLM under one of those names.
        expr: `process_resident_memory_bytes{job=~".*infer.*|.*vllm.*"}`,
      },
    ],
  },
  {
    key: "finish_reason",
    unit: "rps",
    promql: [
      {
        tag: "v1",
        expr: `sum by (finished_reason) (rate(vllm:request_success_total{model_name="${M}"}[1m]))`,
      },
    ],
  },
];

export const vllmManifest: EngineManifest = {
  engineId: "vllm",
  capability: "generative",
  displayName: "vLLM (V0/V1)",
  metrics,
};
