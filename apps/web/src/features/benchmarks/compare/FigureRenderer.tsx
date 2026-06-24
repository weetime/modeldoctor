import type { FigureRefId } from "@modeldoctor/contracts";
import { memo } from "react";
import { assignRunColors } from "@/components/charts/_shared";
import { LatencyCDF } from "@/components/charts/LatencyCDF";
import { PodDistributionChart } from "@/components/charts/PodDistributionChart";
import {
  StageBarChart,
  type StageBarDatum,
  type StageBarLabelColors,
  type StageBarSeries,
} from "@/components/charts/StageBarChart";
import { ThroughputConcurrencyChart } from "@/components/charts/ThroughputConcurrencyChart";
import {
  availableFigureRefIds,
  readCapacityCurve,
  readPodDistribution,
  readPrefixCache,
  summarizeForPrompt,
} from "./client-metrics";
import type { ReportRun } from "./ReportSections";

export interface FigureRendererProps {
  refId: FigureRefId;
  runs: ReportRun[];
  caption: string;
  figureNumber: number;
  /** Baseline run id for per-bar delta annotations. */
  baselineId?: string | null;
}

/** Fixed Primer light colors — the report "paper" is always light (even in
 * dark mode / PDF), so chart labels must not follow the app theme. */
const REPORT_LABEL_COLORS: StageBarLabelColors = {
  value: "#1f2328",
  up: "#1a7f37",
  down: "#d1242f",
  baseline: "#59636e",
};

/** Fixed light palette for the always-light report paper — mirrors
 * FALLBACK_CHART_TOKENS.palette (theme.ts) so report figures match the
 * in-app light theme regardless of the viewer's dark/light mode. */
const REPORT_PALETTE = [
  "hsl(98, 38%, 46%)",
  "hsl(43, 81%, 47%)",
  "hsl(190, 65%, 50%)",
  "hsl(22, 85%, 48%)",
  "hsl(4, 75%, 47%)",
  "hsl(208, 73%, 44%)",
  "hsl(308, 47%, 45%)",
  "hsl(260, 28%, 42%)",
] as const;

const PERCENTILES = ["p50", "p90", "p99"] as const;
// ITL (TPOT) only carries p50/p95 across tools — see MetricKind.
const ITL_PERCENTILES = ["p50", "p95"] as const;

/** Index of the baseline stage within `rows` (preserving their order). Falls
 * back to the first stage when no baseline is set or it was filtered out. */
function baselineIndexOf(rows: { r: ReportRun }[], baselineId?: string | null): number | undefined {
  if (rows.length === 0) return undefined;
  if (baselineId) {
    const i = rows.findIndex(({ r }) => r.id === baselineId);
    if (i >= 0) return i;
  }
  return 0;
}

/** Run id of the baseline series for run-pivoted figures. Same fallback
 * semantics as {@link baselineIndexOf}: first run when unset/filtered out. */
function baselineKeyOf(rows: { r: ReportRun }[], baselineId?: string | null): string | undefined {
  const i = baselineIndexOf(rows, baselineId);
  // `baselineIndexOf` already returns undefined for empty rows, but guard the
  // index access explicitly so the safety is local and obvious.
  return i !== undefined && rows[i] ? rows[i].r.id : undefined;
}

/**
 * Renders a figure by `refId` referencing existing chart components. The LLM
 * picks the refId; the data comes from `runs`. Single source of styling means
 * AI-generated reports look identical regardless of which figure the AI chose.
 *
 * Bars carry static value labels + a colored ↑/↓ % delta vs the baseline stage
 * so the chart reads correctly in print / PDF / export (no hover needed).
 *
 * If the underlying runs do not carry the data this refId needs (e.g. vegeta
 * has no TTFT distribution), we render an inline "data unavailable" placeholder
 * instead of an empty chart. The server-side prompt also receives the same
 * availability set so the LLM can avoid picking the refId in the first place.
 *
 * `memo`-wrapped: the host report runs a scroll-spy that re-renders on every
 * scroll. Its props (refId/runs/caption/figureNumber/baselineId) are stable
 * across those re-renders, so memoization skips recomputing summaries and
 * rebuilding chart options — and avoids re-rendering the ECharts canvases — on
 * scroll.
 */
export const FigureRenderer = memo(function FigureRenderer({
  refId,
  runs,
  caption,
  figureNumber,
  baselineId,
}: FigureRendererProps) {
  const summaries = runs
    .filter((r) => r.benchmark !== null)
    .map((r) => ({ r, s: summarizeForPrompt(r.summaryMetrics) }));
  // One identity color per run, shared by every figure in the report.
  const colorMap = assignRunColors(
    summaries.map(({ r }) => r.id),
    REPORT_PALETTE,
  );

  const available = availableFigureRefIds(
    runs.map((r) => ({
      summaryMetrics: r.summaryMetrics,
      serverMetrics: r.benchmark?.serverMetrics,
      hasLatencyCdf: !!r.benchmark?.latencyCdf?.samples?.length,
    })),
  );
  if (!available.has(refId)) {
    return (
      <figure className="pr-figure">
        <div className="pr-figure-body pr-figure-placeholder">
          <span>
            <strong>{refId}</strong> — data unavailable for these runs
          </span>
        </div>
        <figcaption className="pr-figure-caption">
          <strong>Figure {figureNumber}</strong> · {caption}
        </figcaption>
      </figure>
    );
  }

  let chart: React.ReactNode = null;

  if (refId === "stage-bars-throughput") {
    const data: StageBarDatum[] = summaries.map(({ r, s }) => ({
      stage: r.stageLabel,
      qps: s.throughput ?? 0,
    }));
    chart = (
      <StageBarChart
        title="Throughput"
        data={data}
        series={[{ key: "qps", label: "QPS", color: "#2980b9", decimals: 2, higherIsBetter: true }]}
        barColors={summaries.map(({ r }) => colorMap[r.id])}
        yLabel="req/s"
        baselineIndex={baselineIndexOf(summaries, baselineId)}
        labelColors={REPORT_LABEL_COLORS}
      />
    );
  } else if (refId === "stage-bars-error-rate") {
    const data: StageBarDatum[] = summaries.map(({ r, s }) => ({
      stage: r.stageLabel,
      err: (s.errorRate ?? 0) * 100,
    }));
    chart = (
      <StageBarChart
        title="Error rate"
        data={data}
        series={[{ key: "err", label: "%", color: "#c0392b", decimals: 1, higherIsBetter: false }]}
        barColors={summaries.map(({ r }) => colorMap[r.id])}
        yLabel="%"
        baselineIndex={baselineIndexOf(summaries, baselineId)}
        labelColors={REPORT_LABEL_COLORS}
      />
    );
  } else if (refId === "stage-bars-ttft-p95") {
    // Pivoted: x = percentile, series = run — run colors match every other figure.
    const rows = summaries.filter(({ s }) => s.ttft);
    const data: StageBarDatum[] = PERCENTILES.map((p) => ({
      stage: p,
      ...Object.fromEntries(rows.map(({ r, s }) => [r.id, s.ttft?.[p] ?? 0])),
    }));
    const series: StageBarSeries[] = rows.map(({ r }) => ({
      key: r.id,
      label: r.stageLabel,
      color: colorMap[r.id],
      decimals: 0,
      higherIsBetter: false,
    }));
    chart = (
      <StageBarChart
        title="TTFT percentiles"
        data={rows.length > 0 ? data : []}
        series={series}
        yLabel="ms"
        logScale
        baselineSeriesKey={baselineKeyOf(rows, baselineId)}
        labelColors={REPORT_LABEL_COLORS}
      />
    );
  } else if (refId === "stage-bars-tpot-p95") {
    // ITL carries only p50/p95 (see MetricKind), so this figure shows two bars.
    const rows = summaries.filter(({ s }) => s.itl);
    const data: StageBarDatum[] = ITL_PERCENTILES.map((p) => ({
      stage: p,
      ...Object.fromEntries(rows.map(({ r, s }) => [r.id, s.itl?.[p] ?? 0])),
    }));
    const series: StageBarSeries[] = rows.map(({ r }) => ({
      key: r.id,
      label: r.stageLabel,
      color: colorMap[r.id],
      decimals: 0,
      higherIsBetter: false,
    }));
    chart = (
      <StageBarChart
        title="TPOT (inter-token) percentiles"
        data={rows.length > 0 ? data : []}
        series={series}
        yLabel="ms"
        logScale
        baselineSeriesKey={baselineKeyOf(rows, baselineId)}
        labelColors={REPORT_LABEL_COLORS}
      />
    );
  } else if (refId === "stage-bars-e2e-p95") {
    const rows = summaries.filter(({ s }) => s.e2e);
    const data: StageBarDatum[] = PERCENTILES.map((p) => ({
      stage: p,
      ...Object.fromEntries(rows.map(({ r, s }) => [r.id, s.e2e?.[p] ?? 0])),
    }));
    const series: StageBarSeries[] = rows.map(({ r }) => ({
      key: r.id,
      label: r.stageLabel,
      color: colorMap[r.id],
      decimals: 0,
      higherIsBetter: false,
    }));
    chart = (
      <StageBarChart
        title="E2E latency percentiles"
        data={rows.length > 0 ? data : []}
        series={series}
        yLabel="ms"
        logScale
        baselineSeriesKey={baselineKeyOf(rows, baselineId)}
        labelColors={REPORT_LABEL_COLORS}
      />
    );
  } else if (refId === "stage-bars-prefix-cache-hit") {
    const rows = summaries
      .map(({ r }) => ({ r, pc: readPrefixCache(r.benchmark?.serverMetrics) }))
      .filter((x) => x.pc !== null);
    const data: StageBarDatum[] = rows.map(({ r, pc }) => ({
      stage: r.stageLabel,
      hit: pc?.hitRatePct ?? 0,
    }));
    chart = (
      <StageBarChart
        title="Prefix cache hit rate"
        data={data}
        series={[{ key: "hit", label: "%", color: "#1a7f37", decimals: 1, higherIsBetter: true }]}
        barColors={rows.map(({ r }) => colorMap[r.id])}
        yLabel="%"
        baselineIndex={baselineIndexOf(rows, baselineId)}
        labelColors={REPORT_LABEL_COLORS}
      />
    );
  } else if (refId === "stage-bars-top-pod-share") {
    const rows = summaries
      .map(({ r }) => ({ r, pc: readPrefixCache(r.benchmark?.serverMetrics) }))
      .filter((x) => x.pc !== null);
    const data: StageBarDatum[] = rows.map(({ r, pc }) => ({
      stage: r.stageLabel,
      share: pc?.topPodSharePct ?? 0,
    }));
    chart = (
      <StageBarChart
        title="Top pod share"
        data={data}
        // No higherIsBetter: concentration isn't strictly good or bad — a flat
        // share with rising hit rate = good locality without hot-spotting.
        series={[{ key: "share", label: "%", color: "#8250df", decimals: 1 }]}
        barColors={rows.map(({ r }) => colorMap[r.id])}
        yLabel="%"
        baselineIndex={baselineIndexOf(rows, baselineId)}
        labelColors={REPORT_LABEL_COLORS}
      />
    );
  } else if (refId === "pod-traffic-distribution") {
    const data = summaries
      .map(({ r }) => ({ r, pods: readPodDistribution(r.benchmark?.serverMetrics) }))
      .filter((x) => x.pods && x.pods.length > 0)
      .map(({ r, pods }) => {
        const total = (pods ?? []).reduce((s, p) => s + p.queries, 0) || 1;
        return {
          stage: r.stageLabel,
          pods: (pods ?? []).map((p) => ({ pod: p.pod, value: (p.queries / total) * 100 })),
        };
      });
    chart = (
      <PodDistributionChart
        title="Per-pod traffic share"
        data={data}
        unit="%"
        scheme="neutral"
        labelColors={REPORT_LABEL_COLORS}
      />
    );
  } else if (refId === "pod-hit-rate") {
    const data = summaries
      .map(({ r }) => ({ r, pods: readPodDistribution(r.benchmark?.serverMetrics) }))
      .filter((x) => x.pods && x.pods.length > 0)
      .map(({ r, pods }) => ({
        stage: r.stageLabel,
        pods: (pods ?? []).map((p) => ({
          pod: p.pod,
          value: p.queries > 0 ? (p.hits / p.queries) * 100 : 0,
        })),
      }));
    chart = (
      <PodDistributionChart
        title="Per-pod hit rate"
        data={data}
        unit="%"
        scheme="positive"
        labelColors={REPORT_LABEL_COLORS}
      />
    );
  } else if (refId === "throughput-vs-concurrency") {
    const series = summaries
      .map(({ r }) => ({ r, curve: readCapacityCurve(r.summaryMetrics) }))
      .filter((x) => x.curve)
      .map(({ r, curve }) => ({
        stage: r.stageLabel,
        points: (curve ?? []).map((p) => ({ concurrency: p.concurrency, rps: p.rps })),
      }));
    chart = <ThroughputConcurrencyChart title="Throughput vs concurrency" series={series} />;
  } else if (refId === "latency-distribution") {
    const series = summaries.flatMap(({ r }) => {
      const samples = r.benchmark?.latencyCdf?.samples;
      return samples && samples.length > 0
        ? [{ runId: r.id, runLabel: r.stageLabel, samples }]
        : [];
    });
    // Report paper is always light — force the light theme so the CDF's axis /
    // legend text stays dark and legible regardless of the app theme.
    chart = (
      <LatencyCDF
        ariaLabel="Latency CDF by stage"
        series={series}
        colorMap={colorMap}
        theme="light"
      />
    );
  } else if (refId === "cold-warm-delta") {
    chart = <ColdWarmDeltaTable runs={runs} baselineId={baselineId} />;
  } else if (refId === "compare-grid") {
    chart = <FourMetricTable runs={runs} />;
  }

  return (
    <figure className="pr-figure">
      <div className="pr-figure-body">{chart}</div>
      <figcaption className="pr-figure-caption">
        <strong>Figure {figureNumber}</strong> · {caption}
      </figcaption>
    </figure>
  );
});

/** Compact 4-metric table for the compare-grid figure refId. */
function FourMetricTable({ runs }: { runs: ReportRun[] }) {
  const rows = runs
    .filter((r) => r.benchmark !== null)
    .map((r) => ({ r, s: summarizeForPrompt(r.summaryMetrics) }));
  return (
    <table>
      <thead>
        <tr>
          <th>Stage</th>
          <th style={{ textAlign: "right" }}>QPS</th>
          <th style={{ textAlign: "right" }}>Err %</th>
          <th style={{ textAlign: "right" }}>TTFT p90</th>
          <th style={{ textAlign: "right" }}>E2E p90</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ r, s }) => (
          <tr key={r.id}>
            <td>
              <strong>{r.stageLabel}</strong>
            </td>
            <td style={{ textAlign: "right", fontFamily: "var(--pr-mono)" }}>
              {s.throughput?.toFixed(2) ?? "—"}
            </td>
            <td style={{ textAlign: "right", fontFamily: "var(--pr-mono)" }}>
              {s.errorRate !== null ? (s.errorRate * 100).toFixed(2) : "—"}
            </td>
            <td style={{ textAlign: "right", fontFamily: "var(--pr-mono)" }}>
              {s.ttft?.p90?.toFixed(0) ?? "—"}
            </td>
            <td style={{ textAlign: "right", fontFamily: "var(--pr-mono)" }}>
              {s.e2e?.p90?.toFixed(0) ?? "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Compact cold-warm delta table: one row per stage, QPS / TTFT p90 / E2E p90
 * columns, plus a Δ% column vs the baseline stage. Models FourMetricTable's
 * markup — static text, mono font for numbers, no hover dependency. */
function ColdWarmDeltaTable({
  runs,
  baselineId,
}: {
  runs: ReportRun[];
  baselineId?: string | null;
}) {
  const rows = runs
    .filter((r) => r.benchmark !== null)
    .map((r) => ({ r, s: summarizeForPrompt(r.summaryMetrics) }));

  const baseIdx = baselineIndexOf(rows, baselineId) ?? 0;
  const baseRow = rows[baseIdx];
  const baseS = baseRow?.s;

  function deltaPct(value: number | null | undefined, base: number | null | undefined): string {
    if (value == null || base == null || base === 0) return "—";
    const d = ((value - base) / Math.abs(base)) * 100;
    return `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`;
  }

  // Δ% is compared against QPS (higher-is-better) — we surface all three
  // metrics' raw values and a single Δ% on QPS as the headline delta.
  return (
    <table>
      <thead>
        <tr>
          <th>Stage</th>
          <th style={{ textAlign: "right" }}>QPS</th>
          <th style={{ textAlign: "right" }}>TTFT p90 (ms)</th>
          <th style={{ textAlign: "right" }}>E2E p90 (ms)</th>
          <th style={{ textAlign: "right" }}>Δ QPS vs baseline</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ r, s }, idx) => (
          <tr key={r.id}>
            <td>
              <strong>{r.stageLabel}</strong>
              {idx === baseIdx ? (
                <span style={{ fontFamily: "var(--pr-mono)", color: "#59636e" }}> baseline</span>
              ) : null}
            </td>
            <td style={{ textAlign: "right", fontFamily: "var(--pr-mono)" }}>
              {s.throughput?.toFixed(2) ?? "—"}
            </td>
            <td style={{ textAlign: "right", fontFamily: "var(--pr-mono)" }}>
              {s.ttft?.p90?.toFixed(0) ?? "—"}
            </td>
            <td style={{ textAlign: "right", fontFamily: "var(--pr-mono)" }}>
              {s.e2e?.p90?.toFixed(0) ?? "—"}
            </td>
            <td style={{ textAlign: "right", fontFamily: "var(--pr-mono)" }}>
              {idx === baseIdx ? "—" : deltaPct(s.throughput, baseS?.throughput)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
