import type { MetricRowSpec } from "../core/row-descriptor.js";

// Vegeta is a gateway-layer load tester — it surfaces a single `latencies`
// distribution (no separate ttft / itl) plus min / mean / max stats that
// aren't represented in MetricKind. Hence the "raw" entries for min, mean,
// and max alongside the percentile rows.
export const vegetaRowDescriptors: readonly MetricRowSpec[] = [
  {
    source: "raw",
    labelKey: "latencyMin",
    section: "latencies",
    field: "min",
    format: "latencyMs",
  },
  {
    source: "raw",
    labelKey: "latencyMean",
    section: "latencies",
    field: "mean",
    format: "latencyMs",
  },
  { source: "metric", labelKey: "latencyP50", metric: "e2e.p50", format: "latencyMs" },
  { source: "metric", labelKey: "latencyP90", metric: "e2e.p90", format: "latencyMs" },
  {
    source: "metric",
    labelKey: "latencyP95",
    metric: "e2e.p95",
    format: "latencyMs",
    verdictKind: "latency",
  },
  { source: "metric", labelKey: "latencyP99", metric: "e2e.p99", format: "latencyMs" },
  {
    source: "raw",
    labelKey: "latencyMax",
    section: "latencies",
    field: "max",
    format: "latencyMs",
  },
  {
    source: "metric",
    labelKey: "errorRate",
    metric: "errorRate",
    format: "percent",
    verdictKind: "errorRate",
  },
  {
    source: "metric",
    labelKey: "throughput",
    metric: "requestsPerSec",
    format: "throughput",
    verdictKind: "throughput",
  },
];
