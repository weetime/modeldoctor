import type { GenaiPerfReport } from "@modeldoctor/tool-adapters/schemas";
import { MetricCard } from "../components/MetricCard";

export interface GenaiPerfReportViewProps {
  data: GenaiPerfReport;
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

export function GenaiPerfReportView({ data }: GenaiPerfReportViewProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      <MetricCard
        title={`Request throughput (${data.requestThroughput.unit})`}
        rows={[{ label: "avg", value: fmt(data.requestThroughput.avg) }]}
      />
      <MetricCard
        title={`Output throughput (${data.outputTokenThroughput.unit})`}
        rows={[{ label: "avg", value: fmt(data.outputTokenThroughput.avg) }]}
      />
      <MetricCard
        title={`Request latency (${data.requestLatency.unit})`}
        rows={[
          { label: "avg", value: fmt(data.requestLatency.avg) },
          { label: "p50", value: fmt(data.requestLatency.p50) },
          { label: "p90", value: fmt(data.requestLatency.p90) },
          { label: "p95", value: fmt(data.requestLatency.p95) },
          { label: "p99", value: fmt(data.requestLatency.p99) },
        ]}
      />
      <MetricCard
        title={`TTFT (${data.timeToFirstToken.unit})`}
        rows={[
          { label: "avg", value: fmt(data.timeToFirstToken.avg) },
          { label: "p50", value: fmt(data.timeToFirstToken.p50) },
          { label: "p90", value: fmt(data.timeToFirstToken.p90) },
          { label: "p95", value: fmt(data.timeToFirstToken.p95) },
          { label: "p99", value: fmt(data.timeToFirstToken.p99) },
        ]}
      />
      <MetricCard
        title={`Inter-token latency (${data.interTokenLatency.unit})`}
        rows={[
          { label: "avg", value: fmt(data.interTokenLatency.avg) },
          { label: "p50", value: fmt(data.interTokenLatency.p50) },
          { label: "p90", value: fmt(data.interTokenLatency.p90) },
          { label: "p95", value: fmt(data.interTokenLatency.p95) },
          { label: "p99", value: fmt(data.interTokenLatency.p99) },
        ]}
      />
      <MetricCard
        title="Sequence length"
        rows={[
          { label: "input avg", value: fmt(data.inputSequenceLength.avg, 0) },
          { label: "input p99", value: fmt(data.inputSequenceLength.p99, 0) },
          { label: "output avg", value: fmt(data.outputSequenceLength.avg, 0) },
          { label: "output p99", value: fmt(data.outputSequenceLength.p99, 0) },
        ]}
      />
    </div>
  );
}
