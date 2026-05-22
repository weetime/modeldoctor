import type { Benchmark } from "@modeldoctor/contracts";
import { AiperfInferenceMetrics } from "./aiperf/InferenceMetrics";
import { EvalscopeInferenceMetrics } from "./evalscope/InferenceMetrics";
import { GuidellmInferenceMetrics } from "./guidellm/InferenceMetrics";
import { UnknownReport } from "./UnknownReport";

export interface InferenceReportProps {
  benchmark: Benchmark;
}

export function InferenceReport({ benchmark }: InferenceReportProps) {
  switch (benchmark.tool) {
    case "guidellm":
      return <GuidellmInferenceMetrics benchmark={benchmark} />;
    case "aiperf":
      return <AiperfInferenceMetrics benchmark={benchmark} />;
    case "evalscope":
      return <EvalscopeInferenceMetrics benchmark={benchmark} />;
    default:
      return <UnknownReport benchmark={benchmark} />;
  }
}
