import type { Benchmark } from "@modeldoctor/contracts";
import { UnknownReport } from "./UnknownReport";
import { GuidellmCapacityMetrics } from "./guidellm/CapacityMetrics";

export interface CapacityReportProps {
  benchmark: Benchmark;
}

export function CapacityReport({ benchmark }: CapacityReportProps) {
  if (benchmark.tool !== "guidellm") {
    return <UnknownReport benchmark={benchmark} />;
  }
  return <GuidellmCapacityMetrics benchmark={benchmark} />;
}
