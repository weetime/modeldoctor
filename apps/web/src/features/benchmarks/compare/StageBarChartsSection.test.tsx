import "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StageBarChartsSection } from "./StageBarChartsSection";

vi.mock("echarts-for-react", () => ({
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echart" data-option={JSON.stringify(option)} />
  ),
}));

const guidellmMetrics = (qps: number, errPct: number) => ({
  tool: "guidellm",
  data: {
    ttft: { p50: 100, p90: 200, p99: 500 },
    e2eLatency: { p50: 800, p90: 1500, p99: 3000 },
    requestsPerSecond: { mean: qps },
    requests: { total: 1000, error: Math.round((errPct / 100) * 1000) },
  },
});

describe("StageBarChartsSection", () => {
  it("renders 4 chart panels for guidellm runs", () => {
    render(
      <StageBarChartsSection
        runs={[
          {
            id: "a",
            stageLabel: "A",
            tool: "guidellm",
            summaryMetrics: guidellmMetrics(3, 0),
          },
          {
            id: "b",
            stageLabel: "B",
            tool: "guidellm",
            summaryMetrics: guidellmMetrics(3.5, 0.5),
          },
        ]}
      />,
    );
    expect(screen.getByText(/QPS/)).toBeInTheDocument();
    expect(screen.getByText(/TTFT/i)).toBeInTheDocument();
    expect(screen.getByText(/e2e/i)).toBeInTheDocument();
  });
});
