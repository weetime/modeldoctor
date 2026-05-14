import type { Benchmark } from "@modeldoctor/contracts";
import { evalscopeReportSchema } from "@modeldoctor/tool-adapters/schemas";
import { UnknownReport } from "../UnknownReport";
import { InferenceMetricsGrid } from "../_shared/InferenceMetricsGrid";

export interface EvalscopeInferenceMetricsProps {
  benchmark: Benchmark;
}

export function EvalscopeInferenceMetrics({ benchmark }: EvalscopeInferenceMetricsProps) {
  const tagged = benchmark.summaryMetrics as { tool?: string; data?: unknown } | null;
  const parsed = evalscopeReportSchema.safeParse(tagged?.data);
  if (!parsed.success) {
    return <UnknownReport benchmark={benchmark} reason={parsed.error.message} />;
  }
  const r = parsed.data;
  return (
    <InferenceMetricsGrid
      data={{
        ttft: r.ttft,
        itl: r.itl,
        e2e: r.e2eLatency,
        throughput: r.throughput,
        requests: r.requests,
        prefixCache: r.prefixCacheStats,
      }}
    />
  );
}
