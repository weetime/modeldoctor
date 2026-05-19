import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BarChart } from "./BarChart.js";

const SERIES_A = {
  name: "success",
  samples: [
    [1715212800, 10],
    [1715212815, 20],
  ] as Array<[number, number]>,
};
const SERIES_B = {
  name: "failure",
  samples: [
    [1715212800, 2],
    [1715212815, 3],
  ] as Array<[number, number]>,
};

describe("<BarChart>", () => {
  it("renders one ECharts series per input series", () => {
    render(<BarChart ariaLabel="finish_reason" series={[SERIES_A, SERIES_B]} unit="count" />);
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}") as {
      series?: unknown[];
    };
    expect(opt.series?.length).toBe(2);
  });

  it("sets stack field on every series when stack prop is provided", () => {
    render(
      <BarChart ariaLabel="stacked" series={[SERIES_A, SERIES_B]} unit="count" stack="total" />,
    );
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}") as {
      series?: Array<{ stack?: string }>;
    };
    expect(opt.series?.every((s) => s.stack === "total")).toBe(true);
  });

  it("does not set stack field when stack prop is omitted", () => {
    render(<BarChart ariaLabel="grouped" series={[SERIES_A, SERIES_B]} unit="count" />);
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}") as {
      series?: Array<{ stack?: string }>;
    };
    expect(opt.series?.every((s) => !("stack" in s))).toBe(true);
  });

  it("shows loading placeholder when loading=true", () => {
    render(<BarChart ariaLabel="x" series={[SERIES_A]} unit="count" loading />);
    expect(screen.getByRole("status", { name: "Loading chart" })).toBeInTheDocument();
    expect(screen.queryByTestId("echart")).toBeNull();
  });

  it("shows empty placeholder when series is empty", () => {
    render(<BarChart ariaLabel="x" series={[]} unit="count" />);
    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.queryByTestId("echart")).toBeNull();
  });

  it("shows custom empty message", () => {
    render(<BarChart ariaLabel="x" series={[]} unit="count" empty="No breakdown data" />);
    expect(screen.getByText("No breakdown data")).toBeInTheDocument();
  });
});
