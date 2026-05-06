import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { TestInsightsP95Chart } from "../TestInsightsP95Chart";

// echarts-for-react renders an <Echarts /> div in jsdom; we assert via
// the data-testid the wrapper exposes and the empty/single-point fallback
// text. Don't try to introspect the echarts internals in a unit test.
vi.mock("echarts-for-react", () => ({
  default: (props: { option: unknown }) => (
    <div data-testid="echarts" data-option={JSON.stringify(props.option)} />
  ),
}));

function withI18n(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe("TestInsightsP95Chart", () => {
  it("renders empty placeholder when no data points", () => {
    render(withI18n(<TestInsightsP95Chart points={[]} />));
    expect(screen.getByText(/数据点不足|Not enough data/i)).toBeInTheDocument();
    expect(screen.queryByTestId("echarts")).not.toBeInTheDocument();
  });

  it("renders the line chart when at least one data point exists", () => {
    render(
      withI18n(
        <TestInsightsP95Chart
          points={[
            { ts: "2026-05-01T00:00:00.000Z", p95Ms: 147, name: "run-1" },
            { ts: "2026-05-05T00:00:00.000Z", p95Ms: 296, name: "run-2" },
          ]}
        />,
      ),
    );
    const chart = screen.getByTestId("echarts");
    const opt = JSON.parse(chart.getAttribute("data-option") ?? "{}") as {
      xAxis: { data: string[] };
      series: Array<{ data: number[] }>;
    };
    expect(opt.series[0].data).toEqual([147, 296]);
    expect(opt.xAxis.data).toHaveLength(2);
  });

  it("renders single-point chart without crashing", () => {
    render(
      withI18n(
        <TestInsightsP95Chart
          points={[{ ts: "2026-05-01T00:00:00.000Z", p95Ms: 100, name: "only" }]}
        />,
      ),
    );
    expect(screen.getByTestId("echarts")).toBeInTheDocument();
  });
});
