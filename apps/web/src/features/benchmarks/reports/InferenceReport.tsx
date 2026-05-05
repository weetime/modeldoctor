import type { Benchmark } from "@modeldoctor/contracts";
import { UnknownReport } from "./UnknownReport";
import { GenaiPerfInferenceMetrics } from "./genai-perf/InferenceMetrics";
import { GuidellmInferenceMetrics } from "./guidellm/InferenceMetrics";

export interface InferenceReportProps {
  benchmark: Benchmark;
}

export function InferenceReport({ benchmark }: InferenceReportProps) {
  switch (benchmark.tool) {
    case "guidellm":
      return <GuidellmInferenceMetrics benchmark={benchmark} />;
    case "genai-perf":
      return <GenaiPerfInferenceMetrics benchmark={benchmark} />;
    default:
      return <UnknownReport benchmark={benchmark} />;
  }
}
