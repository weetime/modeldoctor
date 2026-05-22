import type { Benchmark } from "@modeldoctor/contracts";
import { aiperfReportSchema } from "@modeldoctor/tool-adapters/schemas";
import { InferenceMetricsGrid } from "../_shared/InferenceMetricsGrid";
import { UnknownReport } from "../UnknownReport";

export interface AiperfInferenceMetricsProps {
  benchmark: Benchmark;
}

export function AiperfInferenceMetrics({ benchmark }: AiperfInferenceMetricsProps) {
  const tagged = benchmark.summaryMetrics as { tool?: string; data?: unknown } | null;
  const parsed = aiperfReportSchema.safeParse(tagged?.data);
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
      }}
    />
  );
}
