import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { assignRunColors, useChartTokens } from "@/components/charts/_shared";
import {
  StageBarChart,
  type StageBarDatum,
  type StageBarSeries,
} from "@/components/charts/StageBarChart";
import { summarizeForPrompt } from "./client-metrics";

export interface StageRun {
  id: string;
  stageLabel: string;
  tool: string;
  summaryMetrics: unknown;
}

const PERCENTILES = ["p50", "p90", "p99"] as const;

/**
 * 4-panel chart row for the SavedCompare report. Derives QPS / err% / TTFT-percentiles
 * / e2e-percentiles from each run's `summaryMetrics` blob via the client-side mirror of
 * the server prompt summarizer.
 *
 * Every run carries one identity color (assignRunColors over the run order),
 * shared by all four panels: QPS / error-rate bars are colored per run, and
 * the percentile panels are pivoted to "x = percentile, series = run" so the
 * same run is the same color everywhere.
 *
 * Layout note: each `<StageBarChart>` already wraps itself in `rounded-md border p-4`,
 * so the parent (`ReportSections`) MUST NOT add another wrapping border around this
 * component — that would double-border. A bare grid is the correct chrome here.
 */
export function StageBarChartsSection({ runs }: { runs: StageRun[] }) {
  const { t } = useTranslation("benchmarks");
  const tokens = useChartTokens();
  const colorMap = useMemo(
    () => assignRunColors(runs.map((r) => r.id), tokens.palette),
    [runs, tokens],
  );
  const summaries = runs.map((r) => ({ r, s: summarizeForPrompt(r.summaryMetrics) }));

  const qpsErr: StageBarDatum[] = summaries.map(({ r, s }) => ({
    stage: r.stageLabel,
    qps: s.throughput ?? 0,
    err: (s.errorRate ?? 0) * 100,
  }));
  const qpsErrBarColors = summaries.map(({ r }) => colorMap[r.id]);

  // Pivot: one datum per percentile, one series (= one color) per run.
  const ttftRuns = summaries.filter(({ s }) => s.ttft);
  const ttft: StageBarDatum[] = PERCENTILES.map((p) => ({
    stage: p,
    ...Object.fromEntries(ttftRuns.map(({ r, s }) => [r.id, s.ttft?.[p] ?? 0])),
  }));
  const ttftSeries: StageBarSeries[] = ttftRuns.map(({ r }) => ({
    key: r.id,
    label: r.stageLabel,
    color: colorMap[r.id],
  }));

  const e2eRuns = summaries.filter(({ s }) => s.e2e);
  const e2e: StageBarDatum[] = PERCENTILES.map((p) => ({
    stage: p,
    ...Object.fromEntries(e2eRuns.map(({ r, s }) => [r.id, s.e2e?.[p] ?? 0])),
  }));
  const e2eSeries: StageBarSeries[] = e2eRuns.map(({ r }) => ({
    key: r.id,
    label: r.stageLabel,
    color: colorMap[r.id],
  }));

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <StageBarChart
        title={t("savedCompare.report.chartQpsTitle")}
        data={qpsErr}
        series={[{ key: "qps", label: "QPS", color: tokens.palette[0] }]}
        barColors={qpsErrBarColors}
        yLabel="req/s"
      />
      <StageBarChart
        title={t("savedCompare.report.chartErrTitle")}
        data={qpsErr}
        series={[{ key: "err", label: "%", color: tokens.palette[0] }]}
        barColors={qpsErrBarColors}
        yLabel="%"
      />
      <StageBarChart
        title={t("savedCompare.report.chartTtftTitle")}
        data={ttftRuns.length > 0 ? ttft : []}
        series={ttftSeries}
        yLabel="ms"
      />
      <StageBarChart
        title={t("savedCompare.report.chartE2eTitle")}
        data={e2eRuns.length > 0 ? e2e : []}
        series={e2eSeries}
        yLabel="ms"
      />
    </div>
  );
}
