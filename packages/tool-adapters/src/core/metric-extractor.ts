// Standard inference-shape metrics every load-generator tool can expose.
// `null` = the tool doesn't carry this metric (e.g. vegeta has no TTFT),
// the data is missing, or the value is non-finite.
//
// Centralizing these here gives the consumer side a compile-time enum
// to switch on, and gives adapters a single contract to implement.
// Future tool additions can only miss a metric kind on PURPOSE — there
// is no way to silently forget all the consumer call sites.
export type MetricKind =
  | "ttft.p95"
  | "ttft.p99"
  | "itl.p95"
  | "e2e.p95"
  | "e2e.p99"
  | "errorRate" // 0-1 fraction
  | "requestsPerSec"
  | "outputTokensPerSec"
  | "tailRatio"; // e2e.p99 / e2e.p50

export interface ToolMetricExtractor {
  /**
   * Pull one well-known metric out of the tool's persisted summary.
   * `data` is the `.data` payload from `summaryMetrics` (the discriminated
   * union, NOT the wrapped { tool, data } object). Implementations return
   * `null` when:
   *   - the tool doesn't carry that metric (vegeta has no TTFT etc.)
   *   - the data is missing (undefined / wrong shape)
   *   - the value is non-finite
   */
  readMetric(kind: MetricKind, data: Record<string, unknown>): number | null;
}
