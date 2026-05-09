import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Gauge } from "./Gauge.js";

vi.mock("echarts-for-react", () => ({
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echart" data-option={JSON.stringify(option)} />
  ),
}));

describe("<Gauge>", () => {
  it("renders option JSON containing the value", () => {
    render(<Gauge ariaLabel="cache_hit" value={95} unit="%" />);
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}");
    expect(JSON.stringify(opt)).toContain("95");
  });

  it("max defaults to 100 for % unit", () => {
    render(<Gauge ariaLabel="x" value={42} unit="%" />);
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}") as {
      series?: Array<{ max?: number }>;
    };
    expect(opt.series?.[0]?.max).toBe(100);
  });

  it("max defaults to 1 for ratio unit", () => {
    render(<Gauge ariaLabel="x" value={0.5} unit="ratio" />);
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}") as {
      series?: Array<{ max?: number }>;
    };
    expect(opt.series?.[0]?.max).toBe(1);
  });

  it("max defaults to max(value*1.5, 100) for count unit when value > 67", () => {
    render(<Gauge ariaLabel="x" value={200} unit="count" />);
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}") as {
      series?: Array<{ max?: number }>;
    };
    expect(opt.series?.[0]?.max).toBe(300);
  });

  it("max defaults to 100 for count unit when value is small", () => {
    render(<Gauge ariaLabel="x" value={10} unit="count" />);
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}") as {
      series?: Array<{ max?: number }>;
    };
    expect(opt.series?.[0]?.max).toBe(100);
  });

  it("respects explicit max prop", () => {
    render(<Gauge ariaLabel="x" value={50} unit="count" max={500} />);
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}") as {
      series?: Array<{ max?: number }>;
    };
    expect(opt.series?.[0]?.max).toBe(500);
  });

  it("shows loading placeholder when loading=true", () => {
    render(<Gauge ariaLabel="x" value={50} unit="%" loading />);
    expect(screen.getByRole("status", { name: "Loading chart" })).toBeInTheDocument();
    expect(screen.queryByTestId("echart")).toBeNull();
  });

  it("shows empty placeholder when value is null", () => {
    render(<Gauge ariaLabel="x" value={null} unit="%" />);
    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.queryByTestId("echart")).toBeNull();
  });

  it("shows custom empty message", () => {
    render(<Gauge ariaLabel="x" value={null} unit="%" empty="Metric unavailable" />);
    expect(screen.getByText("Metric unavailable")).toBeInTheDocument();
  });
});
