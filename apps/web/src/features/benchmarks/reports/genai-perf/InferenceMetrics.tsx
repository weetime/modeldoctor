import { Stat } from "@/components/charts";
import type { Benchmark, PanelUnit } from "@modeldoctor/contracts";
import { type GenaiPerfReport, genaiPerfReportSchema } from "@modeldoctor/tool-adapters/schemas";
import { MetricCard } from "../../components/MetricCard";
import { UnknownReport } from "../UnknownReport";

export interface GenaiPerfInferenceMetricsProps {
  benchmark: Benchmark;
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

/**
 * Map genai-perf reported unit strings to PanelUnit so Stat cards format
 * consistently with the Engine Metrics KPIs ("3.2 rps", "342.1 tps").
 */
function unitFor(raw: string): PanelUnit {
  const u = raw.toLowerCase();
  if (u.includes("req")) return "rps";
  if (u.includes("tok")) return "tps";
  return "count";
}

export function GenaiPerfInferenceMetrics({ benchmark }: GenaiPerfInferenceMetricsProps) {
  const tagged = benchmark.summaryMetrics as { tool?: string; data?: unknown } | null;
  const parsed = genaiPerfReportSchema.safeParse(tagged?.data);
  if (!parsed.success) {
    return <UnknownReport benchmark={benchmark} reason={parsed.error.message} />;
  }
  const data: GenaiPerfReport = parsed.data;

  return (
    <div className="space-y-6">
      {/* KPI row — single-value throughput metrics as Stat big-numbers,
       * matching the Engine Metrics layout pattern. */}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
      >
        <KpiCard title={`Request throughput (${data.requestThroughput.unit})`}>
          <Stat
            ariaLabel="Request throughput"
            value={data.requestThroughput.avg}
            unit={unitFor(data.requestThroughput.unit)}
            height={80}
          />
        </KpiCard>
        <KpiCard title={`Output throughput (${data.outputTokenThroughput.unit})`}>
          <Stat
            ariaLabel="Output throughput"
            value={data.outputTokenThroughput.avg}
            unit={unitFor(data.outputTokenThroughput.unit)}
          />
        </KpiCard>
      </div>

      {/* Distribution cards — multi-value percentile breakdowns stay in
       * MetricCard. Same density per row → no stretched whitespace. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
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
    </div>
  );
}

function KpiCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}
