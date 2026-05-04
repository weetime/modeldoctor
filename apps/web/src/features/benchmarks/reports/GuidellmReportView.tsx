import type { GuidellmReport } from "@modeldoctor/tool-adapters/schemas";
import { MetricCard } from "../components/MetricCard";

export interface GuidellmReportViewProps {
  data: GuidellmReport;
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

export function GuidellmReportView({ data }: GuidellmReportViewProps) {
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
          { label: "RPS", value: fmt(data.requestsPerSecond.mean) },
          { label: "Output TPS", value: fmt(data.outputTokensPerSecond.mean) },
          { label: "Input TPS", value: fmt(data.inputTokensPerSecond.mean) },
          { label: "Total TPS", value: fmt(data.totalTokensPerSecond.mean) },
        ]}
      />
      <MetricCard
        title="Concurrency"
        rows={[
          { label: "mean", value: fmt(data.concurrency.mean) },
          { label: "max", value: data.concurrency.max },
        ]}
      />
      <MetricCard
        title="Requests"
        rows={[
          { label: "total", value: data.requests.total },
          { label: "success", value: data.requests.success },
          { label: "error", value: data.requests.error },
          { label: "incomplete", value: data.requests.incomplete },
        ]}
      />
    </div>
  );
}
