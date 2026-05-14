import { readMetricSafe } from "@modeldoctor/tool-adapters/schemas";
import type { CheckDescriptor } from "./descriptors";

// `run.summaryMetrics` is the contracts-side discriminated union; the helper
// just needs `{ tool?, data? }`. Cast at the boundary like compare/metrics.ts.
function read(kind: Parameters<typeof readMetricSafe>[0]) {
  return (m: unknown) => readMetricSafe(kind, m as { tool?: unknown; data?: unknown } | null);
}

export const inferenceChecks: CheckDescriptor[] = [
  {
    id: "inference.ttft.p95.ms",
    scenario: "inference",
    toolFilter: ["guidellm", "evalscope", "aiperf"],
    axis: "responsiveness",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    recommendationKey: "checks.inference.ttft.p95.ms.recommendation",
    read: read("ttft.p95"),
  },
  {
    id: "inference.ttft.p99.ms",
    scenario: "inference",
    toolFilter: ["guidellm", "evalscope", "aiperf"],
    axis: "tail",
    defaultWeight: 0.5,
    direction: "lower_is_better",
    recommendationKey: "checks.inference.ttft.p99.ms.recommendation",
    read: read("ttft.p99"),
  },
  {
    id: "inference.itl.p95.ms",
    scenario: "inference",
    toolFilter: ["guidellm", "evalscope", "aiperf"],
    axis: "smoothness",
    defaultWeight: 0.7,
    direction: "lower_is_better",
    recommendationKey: "checks.inference.itl.p95.ms.recommendation",
    read: read("itl.p95"),
  },
  {
    id: "inference.e2e.p95.ms",
    scenario: "inference",
    axis: "responsiveness",
    defaultWeight: 0.7,
    direction: "lower_is_better",
    recommendationKey: "checks.inference.e2e.p95.ms.recommendation",
    read: read("e2e.p95"),
  },
  {
    id: "inference.e2e.p99.ms",
    scenario: "inference",
    axis: "tail",
    defaultWeight: 0.5,
    direction: "lower_is_better",
    recommendationKey: "checks.inference.e2e.p99.ms.recommendation",
    read: read("e2e.p99"),
  },
  {
    id: "inference.error_rate",
    scenario: "inference",
    axis: "stability",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    recommendationKey: "checks.inference.error_rate.recommendation",
    read: read("errorRate"),
  },
  {
    id: "inference.throughput.req_per_s",
    scenario: "inference",
    axis: "throughput",
    defaultWeight: 0.5,
    direction: "higher_is_better",
    recommendationKey: "checks.inference.throughput.req_per_s.recommendation",
    read: read("requestsPerSec"),
  },
];
