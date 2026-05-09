import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PieChart } from "./PieChart.js";

vi.mock("echarts-for-react", () => ({
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echart" data-option={JSON.stringify(option)} />
  ),
}));

const PIE_DATA = [
  { name: "length", value: 42 },
  { name: "stop", value: 18 },
  { name: "error", value: 3 },
];

describe("<PieChart>", () => {
  it("series[0].data.length equals data.length", () => {
    render(<PieChart ariaLabel="finish_reason" data={PIE_DATA} />);
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}") as {
      series?: Array<{ data?: unknown[] }>;
    };
    expect(opt.series?.[0]?.data?.length).toBe(PIE_DATA.length);
  });

  it("renders a donut (radius array) series of type pie", () => {
    render(<PieChart ariaLabel="finish_reason" data={PIE_DATA} />);
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}") as {
      series?: Array<{ type?: string; radius?: unknown }>;
    };
    expect(opt.series?.[0]?.type).toBe("pie");
    expect(Array.isArray(opt.series?.[0]?.radius)).toBe(true);
  });

  it("shows loading placeholder when loading=true", () => {
    render(<PieChart ariaLabel="x" data={PIE_DATA} loading />);
    expect(screen.getByRole("status", { name: "Loading chart" })).toBeInTheDocument();
    expect(screen.queryByTestId("echart")).toBeNull();
  });

  it("shows empty placeholder when data is empty", () => {
    render(<PieChart ariaLabel="x" data={[]} />);
    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.queryByTestId("echart")).toBeNull();
  });

  it("shows custom empty message", () => {
    render(<PieChart ariaLabel="x" data={[]} empty="No breakdown available" />);
    expect(screen.getByText("No breakdown available")).toBeInTheDocument();
  });

  it("applies per-datum color override via itemStyle", () => {
    const dataWithColor = [{ name: "ok", value: 10, color: "#ff0000" }];
    render(<PieChart ariaLabel="x" data={dataWithColor} />);
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}") as {
      series?: Array<{ data?: Array<{ itemStyle?: { color?: string } }> }>;
    };
    expect(opt.series?.[0]?.data?.[0]?.itemStyle?.color).toBe("#ff0000");
  });
});
