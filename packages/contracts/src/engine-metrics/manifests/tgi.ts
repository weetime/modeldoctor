import type { EngineManifest, EngineMetricSpec } from "../../engine-metrics.js";

const metrics: EngineMetricSpec[] = [
  {
    key: "active_requests",
    unit: "count",
    promql: [{ tag: "v1", expr: "sum(tgi_batch_current_size)" }],
  },
  {
    key: "ttft_p99",
    unit: "ms",
    promql: [
      {
        tag: "v1",
        expr: "histogram_quantile(0.99, sum by (le) (rate(tgi_request_inference_duration_bucket[5m]))) * 1000",
      },
    ],
  },
  {
    key: "e2e_latency",
    unit: "ms",
    promql: [
      {
        tag: "v1",
        expr:
          `label_replace(histogram_quantile(0.50, sum by (le) (rate(tgi_request_duration_bucket[1m]))) * 1000, "series", "p50", "", ".*")` +
          ` or label_replace(histogram_quantile(0.95, sum by (le) (rate(tgi_request_duration_bucket[1m]))) * 1000, "series", "p95", "", ".*")` +
          ` or label_replace(histogram_quantile(0.99, sum by (le) (rate(tgi_request_duration_bucket[1m]))) * 1000, "series", "p99", "", ".*")`,
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
          `label_replace((sum(rate(tgi_request_queue_duration_sum[1m])) / clamp_min(sum(rate(tgi_request_queue_duration_count[1m])), 1)) * 1000, "series", "queue", "", ".*")` +
          ` or label_replace((sum(rate(tgi_request_inference_duration_sum[1m])) / clamp_min(sum(rate(tgi_request_inference_duration_count[1m])), 1)) * 1000, "series", "inference", "", ".*")`,
      },
    ],
  },
  {
    key: "token_throughput_out",
    unit: "tps",
    promql: [{ tag: "v1", expr: "sum(rate(tgi_tokenize_total[1m]))" }],
  },
  {
    key: "request_queue_time",
    unit: "ms",
    promql: [
      {
        tag: "v1",
        expr: "histogram_quantile(0.99, sum by (le) (rate(tgi_request_queue_duration_bucket[1m]))) * 1000",
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
          `label_replace(sum(tgi_batch_current_size), "series", "batch", "", ".*")` +
          ` or label_replace(sum(tgi_queue_size), "series", "queue", "", ".*")`,
      },
    ],
  },
];

export const tgiManifest: EngineManifest = {
  engineId: "tgi",
  capability: "generative",
  displayName: "TGI",
  metrics,
};
