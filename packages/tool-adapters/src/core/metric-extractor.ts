// Standard inference-shape metrics every load-generator tool can expose.
// `null` = the tool doesn't carry this metric (e.g. vegeta has no TTFT),
// the data is missing, or the value is non-finite.
//
// Centralizing these here gives the consumer side a compile-time enum
// to switch on, and gives adapters a single contract to implement.
// Future tool additions can only miss a metric kind on PURPOSE — there
// is no way to silently forget all the consumer call sites.
export type MetricKind =
  // Time-to-first-token distribution buckets.
  | "ttft.p50"
  | "ttft.p90"
  | "ttft.p95"
  | "ttft.p99"
  // Inter-token-latency distribution buckets.
  | "itl.p50"
  | "itl.p95"
  // End-to-end latency distribution buckets.
  | "e2e.p50"
  | "e2e.p90"
  | "e2e.p95"
  | "e2e.p99"
  | "errorRate" // 0-1 fraction
  | "requestsPerSec"
  | "outputTokensPerSec"
  | "tailRatio" // e2e.p99 / e2e.p50
  // ── Omni (vllm-omni-bench) — 语音输出实时性指标。非 omni 工具一律返回 null。
  | "realtimeCeiling"      // RTF(mean)<1 的最大并发档
  | "audioTtfpC1.mean"     // 最低并发档的首包均值 (ms)
  | "audioTtfpPeak.p50"
  | "audioTtfpPeak.p99"
  | "audioRtfPeak.mean"
  | "audioRtfPeak.p50"
  | "audioRtfPeak.p99"
  | "voiceTax.ms";         // 最高共档 ΔE2EL(mean), text+audio − text

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
