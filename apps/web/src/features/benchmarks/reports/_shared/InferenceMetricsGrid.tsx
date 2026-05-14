import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("benchmarks");

  const throughputRows: MetricRow[] = [
    { label: t("reports.shared.rps"), value: fmt(data.throughput.requestsPerSec) },
    { label: t("reports.shared.outputTps"), value: fmt(data.throughput.outputTokensPerSec) },
  ];
  if (typeof data.throughput.inputTokensPerSec === "number") {
    throughputRows.push({
      label: t("reports.shared.inputTps"),
      value: fmt(data.throughput.inputTokensPerSec),
    });
  }
  throughputRows.push({
    label: t("reports.shared.totalTps"),
    value: fmt(data.throughput.totalTokensPerSec),
  });

  const requestsRows: MetricRow[] = [
    { label: t("reports.shared.totalLabel"), value: data.requests.total },
    { label: t("reports.shared.successLabel"), value: data.requests.success },
    { label: t("reports.shared.errorLabel"), value: data.requests.error },
  ];
  if (typeof data.requests.incomplete === "number") {
    requestsRows.push({
      label: t("reports.shared.incompleteLabel"),
      value: data.requests.incomplete,
    });
  }
  requestsRows.push({
    label: t("reports.shared.errorRateLabel"),
    value: `${(data.requests.errorRate * 100).toFixed(2)}%`,
  });

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      <MetricCard
        title={t("reports.shared.ttftMs")}
        rows={[
          { label: t("reports.shared.meanLabel"), value: fmt(data.ttft.mean) },
          { label: t("reports.shared.p50Label"), value: fmt(data.ttft.p50) },
          { label: t("reports.shared.p90Label"), value: fmt(data.ttft.p90) },
          { label: t("reports.shared.p95Label"), value: fmt(data.ttft.p95) },
          { label: t("reports.shared.p99Label"), value: fmt(data.ttft.p99) },
        ]}
      />
      <MetricCard
        title={t("reports.shared.itlMs")}
        rows={[
          { label: t("reports.shared.meanLabel"), value: fmt(data.itl.mean) },
          { label: t("reports.shared.p50Label"), value: fmt(data.itl.p50) },
          { label: t("reports.shared.p90Label"), value: fmt(data.itl.p90) },
          { label: t("reports.shared.p95Label"), value: fmt(data.itl.p95) },
          { label: t("reports.shared.p99Label"), value: fmt(data.itl.p99) },
        ]}
      />
      <MetricCard
        title={t("reports.shared.e2eLatencyMs")}
        rows={[
          { label: t("reports.shared.meanLabel"), value: fmt(data.e2e.mean) },
          { label: t("reports.shared.p50Label"), value: fmt(data.e2e.p50) },
          { label: t("reports.shared.p90Label"), value: fmt(data.e2e.p90) },
          { label: t("reports.shared.p95Label"), value: fmt(data.e2e.p95) },
          { label: t("reports.shared.p99Label"), value: fmt(data.e2e.p99) },
        ]}
      />
      <MetricCard title={t("reports.shared.throughput")} rows={throughputRows} />
      {data.concurrency ? (
        <MetricCard
          title={t("reports.shared.concurrency")}
          rows={[
            { label: t("reports.shared.meanLabel"), value: fmt(data.concurrency.mean) },
            { label: t("reports.shared.maxLabel"), value: data.concurrency.max },
          ]}
        />
      ) : null}
      <MetricCard title={t("reports.shared.requests")} rows={requestsRows} />
      {data.prefixCache ? (
        <MetricCard
          title={t("reports.shared.prefixCache")}
          rows={[
            {
              label: t("reports.shared.hitRate"),
              value: `${(data.prefixCache.hitRate * 100).toFixed(1)}%`,
            },
          ]}
        />
      ) : null}
    </div>
  );
}
