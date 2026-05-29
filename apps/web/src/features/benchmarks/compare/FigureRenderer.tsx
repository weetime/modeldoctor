import type { FigureRefId } from "@modeldoctor/contracts";
import { StageBarChart, type StageBarDatum } from "@/components/charts/StageBarChart";
import { availableFigureRefIds, summarizeForPrompt } from "./client-metrics";
import type { ReportRun } from "./ReportSections";

export interface FigureRendererProps {
  refId: FigureRefId;
  runs: ReportRun[];
  caption: string;
  figureNumber: number;
}

/**
 * Renders a figure by `refId` referencing existing chart components. The LLM
 * picks the refId; the data comes from `runs`. Single source of styling means
 * AI-generated reports look identical regardless of which figure the AI chose.
 *
 * If the underlying runs do not carry the data this refId needs (e.g. vegeta
 * has no TTFT distribution), we render an inline "data unavailable" placeholder
 * instead of an empty chart. The server-side prompt also receives the same
 * availability set so the LLM can avoid picking the refId in the first place.
 */
export function FigureRenderer({ refId, runs, caption, figureNumber }: FigureRendererProps) {
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
        series={[{ key: "qps", label: "QPS", color: "#2980b9" }]}
        yLabel="req/s"
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
        series={[{ key: "err", label: "%", color: "#c0392b" }]}
        yLabel="%"
      />
    );
  } else if (refId === "stage-bars-ttft-p95") {
    const data: StageBarDatum[] = summaries
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
    chart = (
      <StageBarChart
        title="TTFT percentiles"
        data={data}
        series={[
          { key: "p50", label: "p50", color: "#27ae60" },
          { key: "p90", label: "p90", color: "#e67e22" },
          { key: "p99", label: "p99", color: "#c0392b" },
        ]}
        yLabel="ms"
      />
    );
  } else if (refId === "stage-bars-e2e-p95") {
    const data: StageBarDatum[] = summaries
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
    chart = (
      <StageBarChart
        title="E2E latency percentiles"
        data={data}
        series={[
          { key: "p50", label: "p50", color: "#27ae60" },
          { key: "p90", label: "p90", color: "#e67e22" },
          { key: "p99", label: "p99", color: "#c0392b" },
        ]}
        yLabel="ms"
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
}

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
          <th style={{ textAlign: "right" }}>TTFT p95</th>
          <th style={{ textAlign: "right" }}>E2E p95</th>
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
