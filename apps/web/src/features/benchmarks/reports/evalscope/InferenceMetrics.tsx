import type { Benchmark } from "@modeldoctor/contracts";
import {
  type EvalscopeReport,
  evalscopeReportSchema,
} from "@modeldoctor/tool-adapters/schemas";
import { MetricCard } from "../../components/MetricCard";
import { UnknownReport } from "../UnknownReport";

export interface EvalscopeInferenceMetricsProps {
  benchmark: Benchmark;
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

export function EvalscopeInferenceMetrics({
  benchmark,
}: EvalscopeInferenceMetricsProps) {
  const tagged = benchmark.summaryMetrics as {
    tool?: string;
    data?: unknown;
  } | null;
  const parsed = evalscopeReportSchema.safeParse(tagged?.data);
  if (!parsed.success) {
    return <UnknownReport benchmark={benchmark} reason={parsed.error.message} />;
  }
  const data: EvalscopeReport = parsed.data;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      <MetricCard
        title="TTFT (ms)"
        rows={[
          { label: "mean", value: fmt(data.ttft.mean) },
          { label: "p50", value: fmt(data.ttft.p50) },
          { label: "p90", value: fmt(data.ttft.p90) },
          { label: "p95", value: fmt(data.ttft.p95) },
          { label: "p99", value: fmt(data.ttft.p99) },
        ]}
      />
      <MetricCard
        title="ITL (ms)"
        rows={[
          { label: "mean", value: fmt(data.itl.mean) },
          { label: "p50", value: fmt(data.itl.p50) },
          { label: "p90", value: fmt(data.itl.p90) },
          { label: "p95", value: fmt(data.itl.p95) },
          { label: "p99", value: fmt(data.itl.p99) },
        ]}
      />
      <MetricCard
        title="E2E latency (ms)"
        rows={[
          { label: "mean", value: fmt(data.e2eLatency.mean) },
          { label: "p50", value: fmt(data.e2eLatency.p50) },
          { label: "p90", value: fmt(data.e2eLatency.p90) },
          { label: "p95", value: fmt(data.e2eLatency.p95) },
          { label: "p99", value: fmt(data.e2eLatency.p99) },
        ]}
      />
      <MetricCard
        title="Throughput"
        rows={[
          { label: "RPS", value: fmt(data.throughput.requestsPerSec) },
          { label: "Output TPS", value: fmt(data.throughput.outputTokensPerSec) },
          { label: "Total TPS", value: fmt(data.throughput.totalTokensPerSec) },
        ]}
      />
      <MetricCard
        title="Requests"
        rows={[
          { label: "total", value: data.requests.total },
          { label: "success", value: data.requests.success },
          { label: "error", value: data.requests.error },
          {
            label: "errorRate",
            value: `${(data.requests.errorRate * 100).toFixed(2)}%`,
          },
        ]}
      />
      {data.prefixCacheStats ? (
        <MetricCard
          title="Prefix cache"
          rows={[
            {
              label: "hitRate",
              value: `${(data.prefixCacheStats.hitRate * 100).toFixed(2)}%`,
            },
          ]}
        />
      ) : null}
    </div>
  );
}
