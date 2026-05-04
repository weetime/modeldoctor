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
