import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { VegetaReport } from "@modeldoctor/tool-adapters/schemas";
import { MetricCard } from "../components/MetricCard";

export interface VegetaReportViewProps {
  data: VegetaReport;
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

export function VegetaReportView({ data }: VegetaReportViewProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          title="Requests"
          rows={[
            { label: "total", value: data.requests.total },
            { label: "rate", value: fmt(data.requests.rate) },
            { label: "throughput", value: fmt(data.requests.throughput) },
          ]}
        />
        <MetricCard
          title="Latency (ms)"
          rows={[
            { label: "min", value: fmt(data.latencies.min) },
            { label: "mean", value: fmt(data.latencies.mean) },
            { label: "p50", value: fmt(data.latencies.p50) },
            { label: "p90", value: fmt(data.latencies.p90) },
            { label: "p95", value: fmt(data.latencies.p95) },
            { label: "p99", value: fmt(data.latencies.p99) },
            { label: "max", value: fmt(data.latencies.max) },
          ]}
        />
        <MetricCard
          title="Success"
          rows={[
            { label: "success%", value: fmt(data.success, 2) },
            { label: "duration (s)", value: fmt(data.duration.totalSeconds) },
            { label: "bytes in (avg)", value: fmt(data.bytesIn.mean, 0) },
            { label: "bytes out (avg)", value: fmt(data.bytesOut.mean, 0) },
          ]}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Status codes
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-1 pt-0 text-sm sm:grid-cols-4">
          {Object.entries(data.statusCodes).map(([code, count]) => (
            <div key={code} className="flex justify-between">
              <span className="text-muted-foreground">{code}</span>
              <span className="font-medium tabular-nums">{count}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {data.errors.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Errors
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 pt-0 text-sm">
            {data.errors.map((err) => (
              <div key={err} className="font-mono text-xs text-destructive">
                {err}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
