import { MetricCard, type MetricRow } from "../../components/MetricCard";

interface Dist {
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

interface Requests {
  total: number;
  success: number;
  error: number;
  errorRate: number;
  /** guidellm exposes this; evalscope/aiperf do not. */
  incomplete?: number;
}

interface Throughput {
  requestsPerSec: number;
  outputTokensPerSec: number;
  totalTokensPerSec: number;
  /** guidellm exposes this; evalscope/aiperf do not. */
  inputTokensPerSec?: number;
}

interface Concurrency {
  mean: number;
  max: number;
}

interface PrefixCache {
  hitRate: number;
}

export interface NormalizedInferenceData {
  ttft: Dist;
  itl: Dist;
  e2e: Dist;
  throughput: Throughput;
  requests: Requests;
  /** guidellm-only panel. */
  concurrency?: Concurrency;
  /** evalscope-only panel. */
  prefixCache?: PrefixCache;
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

export function InferenceMetricsGrid({ data }: { data: NormalizedInferenceData }) {
  const throughputRows: MetricRow[] = [
    { label: "RPS", value: fmt(data.throughput.requestsPerSec) },
    { label: "Output TPS", value: fmt(data.throughput.outputTokensPerSec) },
  ];
  if (typeof data.throughput.inputTokensPerSec === "number") {
    throughputRows.push({ label: "Input TPS", value: fmt(data.throughput.inputTokensPerSec) });
  }
  throughputRows.push({ label: "Total TPS", value: fmt(data.throughput.totalTokensPerSec) });

  const requestsRows: MetricRow[] = [
    { label: "total", value: data.requests.total },
    { label: "success", value: data.requests.success },
    { label: "error", value: data.requests.error },
  ];
  if (typeof data.requests.incomplete === "number") {
    requestsRows.push({ label: "incomplete", value: data.requests.incomplete });
  }
  requestsRows.push({
    label: "errorRate",
    value: `${(data.requests.errorRate * 100).toFixed(2)}%`,
  });

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
          { label: "mean", value: fmt(data.e2e.mean) },
          { label: "p50", value: fmt(data.e2e.p50) },
          { label: "p90", value: fmt(data.e2e.p90) },
          { label: "p95", value: fmt(data.e2e.p95) },
          { label: "p99", value: fmt(data.e2e.p99) },
        ]}
      />
      <MetricCard title="Throughput" rows={throughputRows} />
      {data.concurrency ? (
        <MetricCard
          title="Concurrency"
          rows={[
            { label: "mean", value: fmt(data.concurrency.mean) },
            { label: "max", value: data.concurrency.max },
          ]}
        />
      ) : null}
      <MetricCard title="Requests" rows={requestsRows} />
      {data.prefixCache ? (
        <MetricCard
          title="Prefix cache"
          rows={[
            {
              label: "hitRate",
              value: `${(data.prefixCache.hitRate * 100).toFixed(2)}%`,
            },
          ]}
        />
      ) : null}
    </div>
  );
}
