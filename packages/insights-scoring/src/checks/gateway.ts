import type { CheckDescriptor } from "../descriptors.js";

export const gatewayChecks: CheckDescriptor[] = [
  {
    id: "gateway.error_rate",
    scenario: "gateway",
    toolFilter: ["vegeta"],
    axis: "stability",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    metricKind: "errorRate",
  },
  {
    id: "gateway.tail_ratio",
    scenario: "gateway",
    toolFilter: ["vegeta"],
    axis: "tail",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    metricKind: "tailRatio",
  },
  {
    id: "gateway.throughput.req_per_s",
    scenario: "gateway",
    toolFilter: ["vegeta"],
    axis: "throughput",
    defaultWeight: 0.7,
    direction: "higher_is_better",
    metricKind: "requestsPerSec",
  },
];
