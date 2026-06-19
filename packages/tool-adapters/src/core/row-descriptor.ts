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

// Named display formats resolved on the FE (apps/web compare/format.ts):
//   latencyMs   — ms, 0 decimals when ≥100 else 1, " ms" suffix
//   percent     — 0-1 fraction → percentage, 1 decimal, "%"
//   throughput  — req/s, 1 decimal
//   pct         — value already on a 0-100 scale, 1 decimal, "%"
// When set, `format` takes precedence over `digits` / `unitSuffix`.
export type MetricFormat = "latencyMs" | "percent" | "throughput" | "pct";

export type MetricRowSpec =
  | {
      source: "metric";
      labelKey: string;
      metric: MetricKind;
      verdictKind?: VerdictKind;
      digits?: number;
      unitSuffix?: string;
      format?: MetricFormat;
    }
  | {
      source: "raw";
      labelKey: string;
      section: string;
      field: string;
      unitSuffix?: string;
      format?: MetricFormat;
    };

// Inference-shape tools (guidellm + evalscope + aiperf) all surface the
// same compare-grid rows: ttft / itl / e2eLatency distributions, requests
// throughput, and 0-1 error rate. They re-export this same array, so the
// adapter-side "what columns does my tool contribute" knowledge stays
// single-sourced; one update fans out to all three without drift.
//
// Tool-specific extras (evalscope's prefix-cache hit rate, engine-kv-cache
// cold/warm panel, etc.) live in their own report components, not here.
export const SHARED_INFERENCE_ROWS: readonly MetricRowSpec[] = [
  { source: "raw", labelKey: "ttftMean", section: "ttft", field: "mean", format: "latencyMs" },
  { source: "metric", labelKey: "ttftP50", metric: "ttft.p50", format: "latencyMs" },
  { source: "metric", labelKey: "ttftP95", metric: "ttft.p95", format: "latencyMs" },
  { source: "metric", labelKey: "ttftP99", metric: "ttft.p99", format: "latencyMs" },
  { source: "raw", labelKey: "itlMean", section: "itl", field: "mean", format: "latencyMs" },
  { source: "metric", labelKey: "itlP95", metric: "itl.p95", format: "latencyMs" },
  { source: "metric", labelKey: "e2eLatencyP50", metric: "e2e.p50", format: "latencyMs" },
  {
    source: "metric",
    labelKey: "latencyP95",
    metric: "e2e.p95",
    format: "latencyMs",
    verdictKind: "latency",
  },
  { source: "metric", labelKey: "e2eLatencyP99", metric: "e2e.p99", format: "latencyMs" },
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
