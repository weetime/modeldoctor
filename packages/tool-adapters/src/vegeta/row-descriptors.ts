import type { MetricRowSpec } from "../core/row-descriptor.js";

// Vegeta is a gateway-layer load tester — it surfaces a single `latencies`
// distribution (no separate ttft / itl) plus min / mean / max stats that
// aren't represented in MetricKind. Hence the "raw" entries for min, mean,
// and max alongside the percentile rows.
export const vegetaRowDescriptors: readonly MetricRowSpec[] = [
  { source: "raw", labelKey: "latencyMin", section: "latencies", field: "min", unitSuffix: "ms" },
  {
    source: "raw",
    labelKey: "latencyMean",
    section: "latencies",
    field: "mean",
    unitSuffix: "ms",
  },
  { source: "metric", labelKey: "latencyP50", metric: "e2e.p50", unitSuffix: "ms" },
  { source: "metric", labelKey: "latencyP90", metric: "e2e.p90", unitSuffix: "ms" },
  {
    source: "metric",
    labelKey: "latencyP95",
    metric: "e2e.p95",
    unitSuffix: "ms",
    verdictKind: "latency",
  },
  { source: "metric", labelKey: "latencyP99", metric: "e2e.p99", unitSuffix: "ms" },
  { source: "raw", labelKey: "latencyMax", section: "latencies", field: "max", unitSuffix: "ms" },
  {
    source: "metric",
    labelKey: "errorRate",
    metric: "errorRate",
    digits: 4,
    verdictKind: "errorRate",
  },
  {
    source: "metric",
    labelKey: "throughput",
    metric: "requestsPerSec",
    unitSuffix: "req/s",
    verdictKind: "throughput",
  },
];
