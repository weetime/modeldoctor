import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { assignRunColors, useChartTokens } from "@/components/charts/_shared";
import {
  StageBarChart,
  type StageBarDatum,
  type StageBarSeries,
} from "@/components/charts/StageBarChart";
import {
  ENGINE_BAR_FIGURES,
  readEngineMetric,
  readLatencyPercentiles,
  readPrefixCache,
  summarizeForPrompt,
} from "./client-metrics";

export interface StageRun {
  id: string;
  stageLabel: string;
  tool: string;
  scenario: string;
  summaryMetrics: unknown;
  /** `serverMetrics` blob — carries the lb-strategy prefix-cache annotation. */
  serverMetrics?: unknown;
}

const TTFT_PS = ["p50", "p95", "p99"] as const;
const E2E_PS = ["p50", "p95", "p99"] as const;

// Engine-metric bars (durable serverMetrics.engineMetrics snapshot) → live chart
// title key. Mirrors FigureRenderer's report-side engine bars so the live Charts
// stay symmetric with the table + the saved report. Lower is better for all
// three (less KV pressure / preemption / queueing), but the live charts don't
// colour by polarity, so only the title key is mapped here.
const ENGINE_BAR_TITLE_KEYS: Record<keyof typeof ENGINE_BAR_FIGURES, string> = {
  "stage-bars-kv-cache": "savedCompare.report.chartKvCacheTitle",
  "stage-bars-preemption": "savedCompare.report.chartPreemptionTitle",
  "stage-bars-queue": "savedCompare.report.chartQueueTitle",
};

/**
 * Scenario-aware chart row for the live Compare page. Derives every panel from
 * each run's `summaryMetrics` (+ `serverMetrics` for lb-strategy) and follows
 * the app theme (the AI-report path renders the same metrics on fixed "paper"
 * via FigureRenderer — kept separate on purpose).
 *
 * Chart-type choice: single-scalar-per-run metrics (QPS / error rate / ITL p95
 * / cache hit / pod share) are bars; latency percentile distributions
 * (p50→p95→p99 pivoted to x=percentile, series=run) are lines, which stay
 * readable across many runs where grouped bars crowd.
 *
 * lb-strategy adds prefix-cache hit-rate + top-pod-share bars, but only when
 * EVERY run carries the annotation (mirrors availableFigureRefIds — partial
 * data would render misleading gaps).
 *
 * Layout note: each `<StageBarChart>` already wraps itself in `rounded-md border
 * p-4`, so the parent (`ReportSections`) MUST NOT add another wrapping border.
 */
export function StageBarChartsSection({ runs }: { runs: StageRun[] }) {
  const { t } = useTranslation("benchmarks");
  const tokens = useChartTokens();
  const colorMap = useMemo(
    () =>
      assignRunColors(
        runs.map((r) => r.id),
        tokens.palette,
      ),
    [runs, tokens],
  );
  const summaries = runs.map((r) => ({ r, s: summarizeForPrompt(r.summaryMetrics) }));
  const barColors = runs.map((r) => colorMap[r.id]);

  // Scalar-per-run bars: throughput + error rate (err scaled to 0-100).
  const qpsErr: StageBarDatum[] = summaries.map(({ r, s }) => ({
    stage: r.stageLabel,
    qps: s.throughput ?? 0,
    err: (s.errorRate ?? 0) * 100,
  }));

  // ITL p95 per run (data carries ITL mean + p95 only — a percentile line would
  // be a single point, so render the SLA-relevant tail as a scalar bar).
  const itlRows = runs.map((r) => ({
    r,
    v: readLatencyPercentiles(r.summaryMetrics, "itl", ["p95"])?.p95 ?? null,
  }));
  const showItl = itlRows.some((x) => x.v !== null);
  // Keep missing ITL as null (not 0) — ECharts skips the bar, so a run/tool
  // without ITL reads as "no data" rather than a misleading 0 ms.
  const itlData: StageBarDatum[] = itlRows.map(({ r, v }) => ({
    stage: r.stageLabel,
    itl: v,
  }));

  // Percentile lines: x = percentile category, series = run.
  function percentilePanel(family: "ttft" | "e2e", ps: readonly string[]) {
    const rows = runs
      .map((r) => ({ r, byP: readLatencyPercentiles(r.summaryMetrics, family, ps) }))
      .filter((x): x is { r: StageRun; byP: Record<string, number | null> } => x.byP !== null);
    const data: StageBarDatum[] = ps.map((p) => ({
      stage: p,
      ...Object.fromEntries(rows.map(({ r, byP }) => [r.id, byP[p] ?? null])),
    }));
    const series: StageBarSeries[] = rows.map(({ r }) => ({
      key: r.id,
      label: r.stageLabel,
      color: colorMap[r.id],
    }));
    return { data: rows.length > 0 ? data : [], series };
  }

  const ttft = percentilePanel("ttft", TTFT_PS);
  const e2e = percentilePanel("e2e", E2E_PS);

  // lb-strategy prefix-cache figures, gated on every run carrying the annotation.
  const scenario = runs[0]?.scenario;
  const pcRows = runs.map((r) => ({ r, pc: readPrefixCache(r.serverMetrics) }));
  const showPrefixCache =
    scenario === "lb-strategy" && pcRows.length > 0 && pcRows.every((x) => x.pc !== null);
  const hitData: StageBarDatum[] = pcRows.map(({ r, pc }) => ({
    stage: r.stageLabel,
    hit: pc?.hitRatePct ?? 0,
  }));
  const shareData: StageBarDatum[] = pcRows.map(({ r, pc }) => ({
    stage: r.stageLabel,
    share: pc?.topPodSharePct ?? 0,
  }));

  // Engine-metric bars from the durable serverMetrics.engineMetrics snapshot.
  // Each figure renders only when EVERY run carries that scalar (mirrors
  // availableFigureRefIds' per-figure gate — mixed gaps would read as a
  // misleading 0). unit/yLabel come from the metric's own captured unit.
  const engineBars = (Object.keys(ENGINE_BAR_FIGURES) as Array<keyof typeof ENGINE_BAR_FIGURES>)
    .map((refId) => {
      const spec = ENGINE_BAR_FIGURES[refId];
      const valRows = runs.map((r) => ({
        r,
        v: readEngineMetric(r.serverMetrics, spec.metricKey),
      }));
      const present =
        valRows.length > 0 && valRows.every((x) => x.v !== null && x.v[spec.pick] !== null);
      if (!present) return null;
      const unit = valRows[0].v?.unit ?? "";
      const data: StageBarDatum[] = valRows.map(({ r, v }) => ({
        stage: r.stageLabel,
        val: v?.[spec.pick] ?? 0,
      }));
      return { refId, title: t(ENGINE_BAR_TITLE_KEYS[refId]), data, unit };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <StageBarChart
        title={t("savedCompare.report.chartQpsTitle")}
        data={qpsErr}
        series={[{ key: "qps", label: "QPS", color: tokens.palette[0] }]}
        barColors={barColors}
        unit="rps"
      />
      <StageBarChart
        title={t("savedCompare.report.chartErrTitle")}
        data={qpsErr}
        series={[{ key: "err", label: "%", color: tokens.palette[0] }]}
        barColors={barColors}
        unit="%"
      />
      <StageBarChart
        title={t("savedCompare.report.chartTtftTitle")}
        data={ttft.data}
        series={ttft.series}
        variant="line"
        unit="ms"
      />
      <StageBarChart
        title={t("savedCompare.report.chartE2eTitle")}
        data={e2e.data}
        series={e2e.series}
        variant="line"
        unit="ms"
      />
      {showItl && (
        <StageBarChart
          title={t("savedCompare.report.chartItlTitle")}
          data={itlData}
          series={[{ key: "itl", label: "ITL", color: tokens.palette[0] }]}
          barColors={barColors}
          unit="ms"
        />
      )}
      {showPrefixCache && (
        <>
          <StageBarChart
            title={t("savedCompare.report.chartHitRateTitle")}
            data={hitData}
            series={[{ key: "hit", label: "%", color: tokens.palette[0] }]}
            barColors={barColors}
            unit="%"
          />
          <StageBarChart
            title={t("savedCompare.report.chartTopPodShareTitle")}
            data={shareData}
            series={[{ key: "share", label: "%", color: tokens.palette[0] }]}
            barColors={barColors}
            unit="%"
          />
        </>
      )}
      {engineBars.map((bar) => (
        <StageBarChart
          key={bar.refId}
          title={bar.title}
          data={bar.data}
          series={[{ key: "val", label: bar.unit, color: tokens.palette[0] }]}
          barColors={barColors}
          // The captured unit is a free-form string (engine manifests), not the
          // PanelUnit enum the `unit` prop demands — pass it as `yLabel` instead,
          // mirroring FigureRenderer's report-side engine bars.
          yLabel={bar.unit}
        />
      ))}
    </div>
  );
}
