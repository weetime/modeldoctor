import { readMetricSafe } from "@modeldoctor/tool-adapters/schemas";
import type { CheckDescriptor } from "./descriptors";

function read(kind: Parameters<typeof readMetricSafe>[0]) {
  return (m: unknown) => readMetricSafe(kind, m as { tool?: unknown; data?: unknown } | null);
}

export const capacityChecks: CheckDescriptor[] = [
  {
    id: "capacity.max_qps",
    scenario: "capacity",
    axis: "throughput",
    defaultWeight: 1.0,
    direction: "higher_is_better",
    recommendationKey: "checks.capacity.max_qps.recommendation",
    // For capacity scenario the throughput is the headline number.
    read: read("requestsPerSec"),
  },
  {
    id: "capacity.error_rate",
    scenario: "capacity",
    axis: "stability",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    recommendationKey: "checks.capacity.error_rate.recommendation",
    read: read("errorRate"),
  },
  {
    id: "capacity.tail_ratio",
    scenario: "capacity",
    axis: "tail",
    defaultWeight: 0.7,
    direction: "lower_is_better",
    recommendationKey: "checks.capacity.tail_ratio.recommendation",
    read: read("tailRatio"),
  },
];
