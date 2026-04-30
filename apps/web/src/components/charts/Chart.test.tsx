import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Chart } from "./Chart";

vi.mock("echarts-for-react", () => ({
  default: ({ option, style }: { option: unknown; style?: React.CSSProperties }) => (
    <div data-testid="echart" data-option={JSON.stringify(option)} style={style} />
  ),
}));

describe("<Chart>", () => {
  it("renders scatter with provided points", () => {
    render(
      <Chart
        kind="scatter"
        ariaLabel="emb scatter"
        data={{ points: [{ x: 1, y: 2, label: "a" }] }}
      />,
    );
    const el = screen.getByTestId("echart");
    const opt = JSON.parse(el.getAttribute("data-option") ?? "{}");
    expect(opt.series[0].type).toBe("scatter");
    expect(opt.series[0].data).toEqual([[1, 2, "a"]]);
  });

  it("renders line with multiple series", () => {
    render(
      <Chart
        kind="line"
        ariaLabel="lat"
        data={{
          series: [
            {
              name: "p50",
              data: [
                [0, 10],
                [1, 12],
              ],
            },
            {
              name: "p99",
              data: [
                [0, 50],
                [1, 60],
              ],
            },
          ],
        }}
      />,
    );
    const opt = JSON.parse(screen.getByTestId("echart").getAttribute("data-option") ?? "{}");
    expect(opt.series.length).toBe(2);
    expect(opt.series[0].type).toBe("line");
    expect(opt.legend.data).toEqual(["p50", "p99"]);
  });

  it("shows empty state when empty=true", () => {
    render(<Chart kind="bar" ariaLabel="b" data={{ series: [] }} empty />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it("shows loading skeleton when loading=true", () => {
    render(<Chart kind="bar" ariaLabel="b" data={{ series: [] }} loading />);
    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
  });

  it("applies aria-label", () => {
    render(<Chart kind="scatter" ariaLabel="my-chart" data={{ points: [] }} />);
    expect(screen.getByLabelText("my-chart")).toBeInTheDocument();
  });
});
