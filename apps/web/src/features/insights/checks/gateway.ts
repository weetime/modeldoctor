import { readErrorRate, readThroughput } from "@/features/benchmarks/compare/metrics";
import type { CheckDescriptor } from "./descriptors";

function tailRatio(m: any): number | null {
  if ((m as any)?.tool !== "vegeta") return null;
  const p50 = m?.data?.latencies?.p50;
  const p99 = m?.data?.latencies?.p99;
  if (typeof p50 !== "number" || typeof p99 !== "number" || p50 <= 0) return null;
  return p99 / p50;
}

export const gatewayChecks: CheckDescriptor[] = [
  {
    id: "gateway.error_rate",
    scenario: "gateway",
    toolFilter: ["vegeta"],
    axis: "stability",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    recommendationKey: "checks.gateway.error_rate.recommendation",
    read: (m) => readErrorRate(m as any),
  },
  {
    id: "gateway.tail_ratio",
    scenario: "gateway",
    toolFilter: ["vegeta"],
    axis: "tail",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    recommendationKey: "checks.gateway.tail_ratio.recommendation",
    read: tailRatio,
  },
  {
    id: "gateway.throughput.req_per_s",
    scenario: "gateway",
    toolFilter: ["vegeta"],
    axis: "throughput",
    defaultWeight: 0.7,
    direction: "higher_is_better",
    recommendationKey: "checks.gateway.throughput.req_per_s.recommendation",
    read: (m) => readThroughput(m as any),
  },
];
