import "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StageBarChartsSection, type StageRun } from "./StageBarChartsSection";

const guidellmMetrics = (qps: number, errPct: number) => ({
  tool: "guidellm",
  data: {
    ttft: { p50: 100, p95: 350, p99: 500 },
    itl: { p95: 15 },
    e2eLatency: { p50: 800, p95: 2000, p99: 3000 },
    requestsPerSecond: { mean: qps },
    requests: { total: 1000, error: Math.round((errPct / 100) * 1000) },
  },
});

const prefixCache = (hit: number, share: number) => ({
  prefixCache: {
    hitRatePct: hit,
    topPodSharePct: share,
    perPod: [{ pod: "p0", queries: 10, hits: 5 }],
    metricTag: "v1" as const,
  },
});

type Opt = {
  xAxis?: { data?: string[] };
  series?: Array<{
    name?: string;
    type?: string;
    itemStyle?: { color?: string };
    data?: Array<{ itemStyle?: { color?: string } } | number | null>;
  }>;
};

function readOpts(): Opt[] {
  return screen.getAllByTestId("echart").map((el) => JSON.parse(el.dataset.option ?? "{}") as Opt);
}

describe("StageBarChartsSection", () => {
  it("renders QPS/error bars + TTFT/e2e percentile lines + ITL bar for inference runs", () => {
    render(
      <StageBarChartsSection
        runs={[
          {
            id: "a",
            stageLabel: "A",
            tool: "guidellm",
            scenario: "inference",
            summaryMetrics: guidellmMetrics(3, 0),
          },
          {
            id: "b",
            stageLabel: "B",
            tool: "guidellm",
            scenario: "inference",
            summaryMetrics: guidellmMetrics(3.5, 0.5),
          },
        ]}
      />,
    );
    expect(screen.getByText(/QPS/)).toBeInTheDocument();
    expect(screen.getByText(/TTFT/i)).toBeInTheDocument();
    expect(screen.getByText(/e2e/i)).toBeInTheDocument();
    expect(screen.getByText(/ITL/i)).toBeInTheDocument();

    const opts = readOpts();
    // QPS, error, TTFT line, e2e line, ITL bar (no lb-strategy panels).
    expect(opts).toHaveLength(5);

    // QPS panel: x = run, bars carry per-run identity colors.
    const qps = opts[0];
    expect(qps.xAxis?.data).toEqual(["A", "B"]);
    const qpsBars = qps.series?.[0]?.data as Array<{ itemStyle?: { color?: string } }>;
    expect(qpsBars[0]?.itemStyle?.color).toBeTruthy();
    expect(qpsBars[0]?.itemStyle?.color).not.toBe(qpsBars[1]?.itemStyle?.color);

    // TTFT panel: line, pivoted — x = p50/p95/p99, one series per run.
    const ttft = opts[2];
    expect(ttft.xAxis?.data).toEqual(["p50", "p95", "p99"]);
    expect(ttft.series?.map((s) => s.name)).toEqual(["A", "B"]);
    expect(ttft.series?.every((s) => s.type === "line")).toBe(true);
  });

  it("matches run colors across QPS bars and percentile lines", () => {
    render(
      <StageBarChartsSection
        runs={[
          {
            id: "a",
            stageLabel: "A",
            tool: "guidellm",
            scenario: "inference",
            summaryMetrics: guidellmMetrics(3, 0),
          },
          {
            id: "b",
            stageLabel: "B",
            tool: "guidellm",
            scenario: "inference",
            summaryMetrics: guidellmMetrics(4, 1),
          },
        ]}
      />,
    );
    const opts = readOpts();
    const qpsBarColorA = (opts[0].series?.[0]?.data?.[0] as { itemStyle?: { color?: string } })
      ?.itemStyle?.color;
    const ttftSeriesA = opts[2].series?.find((s) => s.name === "A");
    expect(qpsBarColorA).toBeTruthy();
    expect(ttftSeriesA?.itemStyle?.color).toBe(qpsBarColorA);
  });

  it("adds Hit Rate + Top Pod Share panels for lb-strategy when all runs carry prefix-cache", () => {
    const runs: StageRun[] = [
      {
        id: "a",
        stageLabel: "OFF",
        tool: "aiperf",
        scenario: "lb-strategy",
        summaryMetrics: guidellmMetrics(3, 0),
        serverMetrics: prefixCache(34.5, 60),
      },
      {
        id: "b",
        stageLabel: "ON",
        tool: "aiperf",
        scenario: "lb-strategy",
        summaryMetrics: guidellmMetrics(3.5, 0),
        serverMetrics: prefixCache(57.2, 65),
      },
    ];
    render(<StageBarChartsSection runs={runs} />);
    // QPS, error, TTFT, e2e, ITL, hit-rate, top-pod-share = 7.
    expect(readOpts()).toHaveLength(7);
    expect(screen.getByText(/hit rate/i)).toBeInTheDocument();
    expect(screen.getByText(/top pod share/i)).toBeInTheDocument();
  });

  it("omits prefix-cache panels when only some lb-strategy runs carry data", () => {
    const runs: StageRun[] = [
      {
        id: "a",
        stageLabel: "OFF",
        tool: "aiperf",
        scenario: "lb-strategy",
        summaryMetrics: guidellmMetrics(3, 0),
        serverMetrics: prefixCache(34.5, 60),
      },
      {
        id: "b",
        stageLabel: "ON",
        tool: "aiperf",
        scenario: "lb-strategy",
        summaryMetrics: guidellmMetrics(3.5, 0),
        serverMetrics: null,
      },
    ];
    render(<StageBarChartsSection runs={runs} />);
    expect(readOpts()).toHaveLength(5);
    expect(screen.queryByText(/hit rate/i)).not.toBeInTheDocument();
  });
});
