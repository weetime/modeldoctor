import { readErrorRate, readThroughput } from "@/features/benchmarks/compare/metrics";
import type { CheckDescriptor } from "./descriptors";

function tailRatio(m: any): number | null {
  const t = (m as any)?.tool;
  if (!t) return null;
  let p50: number | null = null;
  let p99: number | null = null;
  if (t === "guidellm") {
    p50 = m?.data?.e2eLatency?.p50 ?? null;
    p99 = m?.data?.e2eLatency?.p99 ?? null;
  } else if (t === "vegeta") {
    p50 = m?.data?.latencies?.p50 ?? null;
    p99 = m?.data?.latencies?.p99 ?? null;
  } else if (t === "evalscope" || t === "aiperf") {
    p50 = m?.data?.e2eLatency?.p50 ?? null;
    p99 = m?.data?.e2eLatency?.p99 ?? null;
  }
  if (typeof p50 !== "number" || typeof p99 !== "number" || p50 <= 0) return null;
  return p99 / p50;
}

export const capacityChecks: CheckDescriptor[] = [
  {
    id: "capacity.max_qps",
    scenario: "capacity",
    axis: "throughput",
    defaultWeight: 1.0,
    direction: "higher_is_better",
    recommendationKey: "checks.capacity.max_qps.recommendation",
    // For capacity scenario the throughput is the headline number — same reader.
    read: (m) => readThroughput(m as any),
  },
  {
    id: "capacity.error_rate",
    scenario: "capacity",
    axis: "stability",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    recommendationKey: "checks.capacity.error_rate.recommendation",
    read: (m) => readErrorRate(m as any),
  },
  {
    id: "capacity.tail_ratio",
    scenario: "capacity",
    axis: "tail",
    defaultWeight: 0.7,
    direction: "lower_is_better",
    recommendationKey: "checks.capacity.tail_ratio.recommendation",
    read: tailRatio,
  },
];
