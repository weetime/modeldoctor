import type { Benchmark } from "@modeldoctor/contracts";
import { GuidellmCapacityMetrics } from "./guidellm/CapacityMetrics";
import { UnknownReport } from "./UnknownReport";

export interface CapacityReportProps {
  benchmark: Benchmark;
}

export function CapacityReport({ benchmark }: CapacityReportProps) {
  if (benchmark.tool !== "guidellm") {
    return <UnknownReport benchmark={benchmark} />;
  }
  return <GuidellmCapacityMetrics benchmark={benchmark} />;
}
