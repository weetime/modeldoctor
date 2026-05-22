import { useTranslation } from "react-i18next";
import { StageBarChart, type StageBarDatum } from "@/components/charts/StageBarChart";
import { summarizeForPrompt } from "./client-metrics";

export interface StageRun {
  id: string;
  stageLabel: string;
  tool: string;
  summaryMetrics: unknown;
}

/**
 * 4-panel chart row for the SavedCompare report. Derives QPS / err% / TTFT-percentiles
 * / e2e-percentiles from each run's `summaryMetrics` blob via the client-side mirror of
 * the server prompt summarizer.
 *
 * Layout note: each `<StageBarChart>` already wraps itself in `rounded-md border p-4`,
 * so the parent (`ReportSections`) MUST NOT add another wrapping border around this
 * component — that would double-border. A bare grid is the correct chrome here.
 */
export function StageBarChartsSection({ runs }: { runs: StageRun[] }) {
  const { t } = useTranslation("benchmarks");
  const summaries = runs.map((r) => ({ r, s: summarizeForPrompt(r.summaryMetrics) }));

  const qpsErr: StageBarDatum[] = summaries.map(({ r, s }) => ({
    stage: r.stageLabel,
    qps: s.throughput ?? 0,
    err: (s.errorRate ?? 0) * 100,
  }));

  const ttft: StageBarDatum[] = summaries
    .filter(({ s }) => s.ttft)
    .map(({ r, s }) => ({
      stage: r.stageLabel,
      // biome-ignore lint/style/noNonNullAssertion: filtered above
      p50: s.ttft!.p50 ?? 0,
      // biome-ignore lint/style/noNonNullAssertion: filtered above
      p90: s.ttft!.p90 ?? 0,
      // biome-ignore lint/style/noNonNullAssertion: filtered above
      p99: s.ttft!.p99 ?? 0,
    }));

  const e2e: StageBarDatum[] = summaries
    .filter(({ s }) => s.e2e)
    .map(({ r, s }) => ({
      stage: r.stageLabel,
      // biome-ignore lint/style/noNonNullAssertion: filtered above
      p50: s.e2e!.p50 ?? 0,
      // biome-ignore lint/style/noNonNullAssertion: filtered above
      p90: s.e2e!.p90 ?? 0,
      // biome-ignore lint/style/noNonNullAssertion: filtered above
      p99: s.e2e!.p99 ?? 0,
    }));

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <StageBarChart
        title={t("savedCompare.report.chartQpsTitle")}
        data={qpsErr}
        series={[{ key: "qps", label: "QPS", color: "#2980b9" }]}
        yLabel="req/s"
      />
      <StageBarChart
        title={t("savedCompare.report.chartErrTitle")}
        data={qpsErr}
        series={[{ key: "err", label: "%", color: "#c0392b" }]}
        yLabel="%"
      />
      <StageBarChart
        title={t("savedCompare.report.chartTtftTitle")}
        data={ttft}
        series={[
          { key: "p50", label: "p50", color: "#27ae60" },
          { key: "p90", label: "p90", color: "#e67e22" },
          { key: "p99", label: "p99", color: "#c0392b" },
        ]}
        yLabel="ms"
      />
      <StageBarChart
        title={t("savedCompare.report.chartE2eTitle")}
        data={e2e}
        series={[
          { key: "p50", label: "p50", color: "#27ae60" },
          { key: "p90", label: "p90", color: "#e67e22" },
          { key: "p99", label: "p99", color: "#c0392b" },
        ]}
        yLabel="ms"
      />
    </div>
  );
}
