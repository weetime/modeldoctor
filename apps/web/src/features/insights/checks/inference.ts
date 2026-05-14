import {
  readErrorRate,
  readP95Latency,
  readThroughput,
} from "@/features/benchmarks/compare/metrics";
import type { CheckDescriptor } from "./descriptors";

function fromDist(metrics: unknown, key: string, field: string): number | null {
  const m = metrics as { tool?: string; data?: Record<string, unknown> } | null;
  if (!m?.data) return null;
  const dist = m.data[key] as Record<string, unknown> | undefined;
  const v = dist?.[field];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export const inferenceChecks: CheckDescriptor[] = [
  {
    id: "inference.ttft.p95.ms",
    scenario: "inference",
    toolFilter: ["guidellm"],
    axis: "responsiveness",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    recommendationKey: "checks.inference.ttft.p95.ms.recommendation",
    read: (m) => {
      const t = (m as { tool?: string } | null)?.tool;
      if (t === "guidellm") return fromDist(m, "ttft", "p95");
      return null;
    },
  },
  {
    id: "inference.ttft.p99.ms",
    scenario: "inference",
    toolFilter: ["guidellm"],
    axis: "tail",
    defaultWeight: 0.5,
    direction: "lower_is_better",
    recommendationKey: "checks.inference.ttft.p99.ms.recommendation",
    read: (m) => {
      const t = (m as { tool?: string } | null)?.tool;
      if (t === "guidellm") return fromDist(m, "ttft", "p99");
      return null;
    },
  },
  {
    id: "inference.itl.p95.ms",
    scenario: "inference",
    toolFilter: ["guidellm"],
    axis: "smoothness",
    defaultWeight: 0.7,
    direction: "lower_is_better",
    recommendationKey: "checks.inference.itl.p95.ms.recommendation",
    read: (m) => fromDist(m, "itl", "p95"),
  },
  {
    id: "inference.e2e.p95.ms",
    scenario: "inference",
    axis: "responsiveness",
    defaultWeight: 0.7,
    direction: "lower_is_better",
    recommendationKey: "checks.inference.e2e.p95.ms.recommendation",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    read: (m) => readP95Latency(m as any),
  },
  {
    id: "inference.e2e.p99.ms",
    scenario: "inference",
    axis: "tail",
    defaultWeight: 0.5,
    direction: "lower_is_better",
    recommendationKey: "checks.inference.e2e.p99.ms.recommendation",
    read: (m) => {
      const t = (m as { tool?: string } | null)?.tool;
      if (t === "guidellm") return fromDist(m, "e2eLatency", "p99");
      if (t === "vegeta") return fromDist(m, "latencies", "p99");
      return null;
    },
  },
  {
    id: "inference.error_rate",
    scenario: "inference",
    axis: "stability",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    recommendationKey: "checks.inference.error_rate.recommendation",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    read: (m) => readErrorRate(m as any),
  },
  {
    id: "inference.throughput.req_per_s",
    scenario: "inference",
    axis: "throughput",
    defaultWeight: 0.5,
    direction: "higher_is_better",
    recommendationKey: "checks.inference.throughput.req_per_s.recommendation",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    read: (m) => readThroughput(m as any),
  },
];
