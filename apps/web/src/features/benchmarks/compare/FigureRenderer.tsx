import type { FigureRefId } from "@modeldoctor/contracts";
import { memo } from "react";
import {
  StageBarChart,
  type StageBarDatum,
  type StageBarLabelColors,
} from "@/components/charts/StageBarChart";
import { availableFigureRefIds, summarizeForPrompt } from "./client-metrics";
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

  const available = availableFigureRefIds(runs.map((r) => r.summaryMetrics));
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
        yLabel="%"
        baselineIndex={baselineIndexOf(summaries, baselineId)}
        labelColors={REPORT_LABEL_COLORS}
      />
    );
  } else if (refId === "stage-bars-ttft-p95") {
    const rows = summaries.filter(({ s }) => s.ttft);
    const data: StageBarDatum[] = rows.map(({ r, s }) => ({
      stage: r.stageLabel,
      // biome-ignore lint/style/noNonNullAssertion: filtered above
      p50: s.ttft!.p50 ?? 0,
      // biome-ignore lint/style/noNonNullAssertion: filtered above
      p90: s.ttft!.p90 ?? 0,
      // biome-ignore lint/style/noNonNullAssertion: filtered above
      p99: s.ttft!.p99 ?? 0,
    }));
    chart = (
      <StageBarChart
        title="TTFT percentiles"
        data={data}
        series={[
          { key: "p50", label: "p50", color: "#27ae60", decimals: 0, higherIsBetter: false },
          { key: "p90", label: "p90", color: "#e67e22", decimals: 0, higherIsBetter: false },
          { key: "p99", label: "p99", color: "#c0392b", decimals: 0, higherIsBetter: false },
        ]}
        yLabel="ms"
        baselineIndex={baselineIndexOf(rows, baselineId)}
        labelColors={REPORT_LABEL_COLORS}
      />
    );
  } else if (refId === "stage-bars-e2e-p95") {
    const rows = summaries.filter(({ s }) => s.e2e);
    const data: StageBarDatum[] = rows.map(({ r, s }) => ({
      stage: r.stageLabel,
      // biome-ignore lint/style/noNonNullAssertion: filtered above
      p50: s.e2e!.p50 ?? 0,
      // biome-ignore lint/style/noNonNullAssertion: filtered above
      p90: s.e2e!.p90 ?? 0,
      // biome-ignore lint/style/noNonNullAssertion: filtered above
      p99: s.e2e!.p99 ?? 0,
    }));
    chart = (
      <StageBarChart
        title="E2E latency percentiles"
        data={data}
        series={[
          { key: "p50", label: "p50", color: "#27ae60", decimals: 0, higherIsBetter: false },
          { key: "p90", label: "p90", color: "#e67e22", decimals: 0, higherIsBetter: false },
          { key: "p99", label: "p99", color: "#c0392b", decimals: 0, higherIsBetter: false },
        ]}
        yLabel="ms"
        baselineIndex={baselineIndexOf(rows, baselineId)}
        labelColors={REPORT_LABEL_COLORS}
      />
    );
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
