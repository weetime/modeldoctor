import type { VerdictKind } from "./metrics";

/**
 * Verdict thresholds + pure comparison functions for the Run compare grid (F2 of #88).
 *
 * Direction asymmetry:
 *   - latency / errorRate: higher = worse (regressed when current > baseline by ≥ threshold)
 *   - throughput:          higher = better (regressed when current < baseline by ≥ threshold)
 *
 * `baseline === 0` guard (latency / throughput): returns "unchanged" rather
 * than "+∞% regressed". A baseline of 0 latency or 0 throughput indicates a
 * degenerate or failed run — surfacing it as a red verdict badge would be
 * misleading; the user should re-run the baseline instead. Error rate is
 * plain subtraction (percentage-points) so it has no division and no guard.
 *
 * Callers must pass finite numbers (or null at the reader layer); NaN/Infinity
 * input is undefined behavior — the metrics.ts readers are responsible for
 * normalizing to `null` when source data is missing.
 */
export const VERDICT_THRESHOLDS = {
  // higher is worse (latency)
  latencyPct: 0.1,
  // higher is worse (error rate); absolute percentage points, not ratio
  errorRatePp: 0.005,
  // higher is better (throughput)
  throughputPct: 0.05,
} as const;

export type Verdict = "regressed" | "improved" | "unchanged";

export function verdictForLatency(baseline: number, current: number): Verdict {
  if (baseline === 0) return "unchanged";
  const pct = (current - baseline) / baseline;
  if (pct >= VERDICT_THRESHOLDS.latencyPct) return "regressed";
  if (pct <= -VERDICT_THRESHOLDS.latencyPct) return "improved";
  return "unchanged";
}

export function verdictForErrorRate(baseline: number, current: number): Verdict {
  const pp = current - baseline;
  if (pp >= VERDICT_THRESHOLDS.errorRatePp) return "regressed";
  if (pp <= -VERDICT_THRESHOLDS.errorRatePp) return "improved";
  return "unchanged";
}

export function verdictForThroughput(baseline: number, current: number): Verdict {
  if (baseline === 0) return "unchanged";
  const pct = (current - baseline) / baseline;
  if (pct <= -VERDICT_THRESHOLDS.throughputPct) return "regressed";
  if (pct >= VERDICT_THRESHOLDS.throughputPct) return "improved";
  return "unchanged";
}

// Dispatcher used by both MetricRow (compare grid) and DetailVerdictRow
// (Run detail page). Keeps the per-kind verdict mapping in one place so
// adding a fourth VerdictKind requires touching only this file (plus
// metrics.ts where the kind is declared).
export function verdictFor(kind: VerdictKind, baseline: number, current: number): Verdict {
  switch (kind) {
    case "latency":
      return verdictForLatency(baseline, current);
    case "errorRate":
      return verdictForErrorRate(baseline, current);
    case "throughput":
      return verdictForThroughput(baseline, current);
  }
}
