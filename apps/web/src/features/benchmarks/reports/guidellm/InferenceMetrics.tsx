import type { Benchmark } from "@modeldoctor/contracts";
import { guidellmReportSchema } from "@modeldoctor/tool-adapters/schemas";
import { InferenceMetricsGrid } from "../_shared/InferenceMetricsGrid";
import { UnknownReport } from "../UnknownReport";

export interface GuidellmInferenceMetricsProps {
  benchmark: Benchmark;
}

export function GuidellmInferenceMetrics({ benchmark }: GuidellmInferenceMetricsProps) {
  const tagged = benchmark.summaryMetrics as { tool?: string; data?: unknown } | null;
  const parsed = guidellmReportSchema.safeParse(tagged?.data);
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
        throughput: {
          requestsPerSec: r.requestsPerSecond.mean,
          outputTokensPerSec: r.outputTokensPerSecond.mean,
          inputTokensPerSec: r.inputTokensPerSecond.mean,
          totalTokensPerSec: r.totalTokensPerSecond.mean,
        },
        requests: {
          total: r.requests.total,
          success: r.requests.success,
          error: r.requests.error,
          incomplete: r.requests.incomplete,
          // guidellm doesn't expose errorRate as a field — compute it
          errorRate: r.requests.total > 0 ? r.requests.error / r.requests.total : 0,
        },
        concurrency: r.concurrency,
      }}
    />
  );
}
