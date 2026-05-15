import type { MetricKind } from "./metric-extractor.js";

// Row descriptors describe one row of the compare-view grid. Each adapter
// owns its row set in `<adapter>/row-descriptors.ts` so adding a new tool /
// changing a column lives next to the rest of that tool's knowledge,
// instead of in a per-tool switch in apps/web.
//
// Specs are pure data (no closures), FE-safe. The FE-side compare module
// materializes each spec into a renderable descriptor by binding `read`
// to either `readMetricSafe(kind, …)` (for "metric" rows) or a raw deep-
// path lookup (for "raw" rows — distribution stats like ttft.mean and
// vegeta's latencies.min/max that aren't first-class MetricKinds).

export type VerdictKind = "latency" | "errorRate" | "throughput";

export type MetricRowSpec =
  | {
      source: "metric";
      labelKey: string;
      metric: MetricKind;
      verdictKind?: VerdictKind;
      digits?: number;
      unitSuffix?: string;
    }
  | {
      source: "raw";
      labelKey: string;
      section: string;
      field: string;
      unitSuffix?: string;
    };

// Inference-shape tools (guidellm + evalscope + aiperf) all surface the
// same compare-grid rows: ttft / itl / e2eLatency distributions, requests
// throughput, and 0-1 error rate. They re-export this same array, so the
// adapter-side "what columns does my tool contribute" knowledge stays
// single-sourced; one update fans out to all three without drift.
//
// Tool-specific extras (evalscope's prefix-cache hit rate, kv-cache-stress
// cold/warm panel, etc.) live in their own report components, not here.
export const SHARED_INFERENCE_ROWS: readonly MetricRowSpec[] = [
  { source: "raw", labelKey: "ttftMean", section: "ttft", field: "mean", unitSuffix: "ms" },
  { source: "metric", labelKey: "ttftP50", metric: "ttft.p50", unitSuffix: "ms" },
  { source: "metric", labelKey: "ttftP95", metric: "ttft.p95", unitSuffix: "ms" },
  { source: "metric", labelKey: "ttftP99", metric: "ttft.p99", unitSuffix: "ms" },
  { source: "raw", labelKey: "itlMean", section: "itl", field: "mean", unitSuffix: "ms" },
  { source: "metric", labelKey: "itlP95", metric: "itl.p95", unitSuffix: "ms" },
  { source: "metric", labelKey: "e2eLatencyP50", metric: "e2e.p50", unitSuffix: "ms" },
  {
    source: "metric",
    labelKey: "latencyP95",
    metric: "e2e.p95",
    unitSuffix: "ms",
    verdictKind: "latency",
  },
  { source: "metric", labelKey: "e2eLatencyP99", metric: "e2e.p99", unitSuffix: "ms" },
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
