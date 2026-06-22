import "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FigureRenderer } from "./FigureRenderer";
import type { ReportRun } from "./ReportSections";

// Minimal guidellm summary metrics fixture — provides throughput + ttft + e2e.
const guidellmMetrics = () => ({
  tool: "guidellm",
  data: {
    ttft: { p50: 120, p95: 400, p99: 600 },
    itl: { p95: 20 },
    e2eLatency: { p50: 900, p95: 2200, p99: 3200 },
    requestsPerSecond: { mean: 4.5 },
    requests: { total: 100, error: 0 },
  },
});

// A serverMetrics blob that carries a full prefixCache annotation including
// a non-empty perPod array — the minimum needed for pod-traffic-distribution
// and pod-hit-rate to pass availableFigureRefIds.
const serverMetricsWithPods = {
  prefixCache: {
    hitRatePct: 57.2,
    topPodSharePct: 65.0,
    perPod: [
      { pod: "pod-0", queries: 60, hits: 40 },
      { pod: "pod-1", queries: 40, hits: 20 },
    ],
    metricTag: "v1" as const,
  },
};

function makeRun(id: string, stageLabel: string, withPods = false): ReportRun {
  return {
    id,
    stageLabel,
    tool: "aiperf",
    scenario: "lb-strategy",
    summaryMetrics: guidellmMetrics(),
    serverMetrics: withPods ? serverMetricsWithPods : null,
    benchmark: {
      id,
      name: `Benchmark ${stageLabel}`,
      tool: "aiperf",
      scenario: "lb-strategy",
      summaryMetrics: guidellmMetrics(),
      serverMetrics: withPods ? serverMetricsWithPods : null,
    },
    paramsSummary: { concurrency: 4 },
  };
}

const runs: ReportRun[] = [makeRun("run-a", "OFF", true), makeRun("run-b", "ON", true)];

describe("FigureRenderer", () => {
  it("renders pod-traffic-distribution chart WITHOUT the data-unavailable placeholder", () => {
    render(
      <FigureRenderer
        refId="pod-traffic-distribution"
        runs={runs}
        caption="Pod traffic share"
        figureNumber={1}
      />,
    );
    // The placeholder text contains "data unavailable" — it must be absent.
    expect(screen.queryByText(/data unavailable/i)).not.toBeInTheDocument();
    // The figure body should contain the chart (rendered as the echart stub).
    expect(screen.getByTestId("echart")).toBeInTheDocument();
  });

  it("renders pod-hit-rate chart WITHOUT the data-unavailable placeholder", () => {
    render(
      <FigureRenderer refId="pod-hit-rate" runs={runs} caption="Pod hit rate" figureNumber={2} />,
    );
    expect(screen.queryByText(/data unavailable/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
  });

  it("renders cold-warm-delta table WITHOUT the data-unavailable placeholder", () => {
    render(
      <FigureRenderer
        refId="cold-warm-delta"
        runs={runs}
        caption="Cold vs warm delta"
        figureNumber={3}
      />,
    );
    expect(screen.queryByText(/data unavailable/i)).not.toBeInTheDocument();
    // Table headers confirm the delta table rendered.
    expect(screen.getByText(/Δ QPS vs baseline/i)).toBeInTheDocument();
    // Both stage labels appear.
    expect(screen.getByText("OFF")).toBeInTheDocument();
    expect(screen.getByText("ON")).toBeInTheDocument();
  });

  it("renders the data-unavailable placeholder when runs lack pod data", () => {
    const runsNoPods: ReportRun[] = [makeRun("x", "X", false), makeRun("y", "Y", false)];
    render(
      <FigureRenderer
        refId="pod-traffic-distribution"
        runs={runsNoPods}
        caption="Pod traffic share"
        figureNumber={4}
      />,
    );
    expect(screen.getByText(/data unavailable/i)).toBeInTheDocument();
    expect(screen.queryByTestId("echart")).not.toBeInTheDocument();
  });

  it("renders throughput-vs-concurrency chart WITHOUT the data-unavailable placeholder", () => {
    // Build a run whose summaryMetrics carries a capacityCurve.
    const capacityCurveMetrics = {
      tool: "guidellm",
      data: {
        capacityCurve: [
          { concurrency: 4, rps: 30, e2eP95Ms: 500 },
          { concurrency: 16, rps: 80, e2eP95Ms: 700 },
        ],
      },
    };
    const runWithCurve: ReportRun = {
      id: "curve-run-a",
      stageLabel: "A",
      tool: "guidellm",
      scenario: "capacity",
      summaryMetrics: capacityCurveMetrics,
      serverMetrics: null,
      benchmark: {
        id: "curve-run-a",
        name: "Benchmark A",
        tool: "guidellm",
        scenario: "capacity",
        summaryMetrics: capacityCurveMetrics,
        serverMetrics: null,
      },
      paramsSummary: { concurrency: 4 },
    };
    render(
      <FigureRenderer
        refId="throughput-vs-concurrency"
        runs={[runWithCurve]}
        caption="Throughput vs concurrency"
        figureNumber={5}
      />,
    );
    // The placeholder text must be absent — the run carries a valid capacityCurve.
    expect(screen.queryByText(/data unavailable/i)).not.toBeInTheDocument();
    // The figure body should contain the chart (rendered as the echart stub).
    expect(screen.getByTestId("echart")).toBeInTheDocument();
  });
});
