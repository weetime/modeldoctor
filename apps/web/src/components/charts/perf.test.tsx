import { render } from "@testing-library/react";
import type { CSSProperties } from "react";
import { describe, expect, it, vi } from "vitest";
import { LatencyCDF } from "./LatencyCDF";
import { PercentileTimeseries } from "./PercentileTimeseries";
import { QPSTimeseries } from "./QPSTimeseries";
import { TTFTHistogram } from "./TTFTHistogram";

vi.mock("echarts-for-react", () => ({
  default: ({ style }: { style?: CSSProperties }) => <div data-testid="echart" style={style} />,
}));

const N = 10_000;
const BUDGET_MS = 1000;

function genTimeseries(n: number): Array<[number, number]> {
  const start = Date.now();
  const out: Array<[number, number]> = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = [start + i * 100, Math.random() * 1000];
  }
  return out;
}

function genSamples(n: number): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = Math.random() * 5000;
  return out;
}

function genBuckets(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    lower: i * 10,
    upper: (i + 1) * 10,
    count: Math.floor(Math.random() * 100),
  }));
}

describe("chart perf smoke (10k points)", () => {
  it("PercentileTimeseries renders 10k points within budget", () => {
    const t0 = performance.now();
    render(
      <PercentileTimeseries
        ariaLabel="perf"
        series={[
          {
            runId: "r",
            percentiles: { p50: genTimeseries(N), p95: genTimeseries(N) },
          },
        ]}
      />,
    );
    expect(performance.now() - t0).toBeLessThan(BUDGET_MS);
  });

  it("LatencyCDF renders 10k samples within budget", () => {
    const t0 = performance.now();
    render(<LatencyCDF ariaLabel="perf" series={[{ runId: "r", samples: genSamples(N) }]} />);
    expect(performance.now() - t0).toBeLessThan(BUDGET_MS);
  });

  it("TTFTHistogram renders 10k buckets within budget", () => {
    const t0 = performance.now();
    render(<TTFTHistogram ariaLabel="perf" series={[{ runId: "r", buckets: genBuckets(N) }]} />);
    expect(performance.now() - t0).toBeLessThan(BUDGET_MS);
  });

  it("QPSTimeseries renders 10k points within budget", () => {
    const t0 = performance.now();
    render(<QPSTimeseries ariaLabel="perf" series={[{ runId: "r", points: genTimeseries(N) }]} />);
    expect(performance.now() - t0).toBeLessThan(BUDGET_MS);
  });
});
