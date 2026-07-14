import type { CheckDescriptor } from "../descriptors.js";

export const capacityChecks: CheckDescriptor[] = [
  {
    id: "capacity.max_qps",
    scenario: "capacity",
    axis: "throughput",
    defaultWeight: 1.0,
    direction: "higher_is_better",
    // For capacity scenario the throughput is the headline number.
    metricKind: "requestsPerSec",
  },
  {
    id: "capacity.error_rate",
    scenario: "capacity",
    axis: "stability",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    metricKind: "errorRate",
  },
  {
    id: "capacity.tail_ratio",
    scenario: "capacity",
    axis: "tail",
    defaultWeight: 0.7,
    direction: "lower_is_better",
    metricKind: "tailRatio",
  },
];
