import type { MetricKind } from "../core/metric-extractor.js";

// Kept in its own file (mirroring guidellm/vegeta/evalscope/aiperf) so
// `core/read-metric-safe.fe.ts` can import it without pulling in
// `runtime.ts` (and, transitively, `build-command.ts`) into the FE bundle.
export function tau3ReadMetric(_kind: MetricKind, _data: Record<string, unknown>): number | null {
  return null; // agent success/pass^k is not an inference-shaped metric
}
