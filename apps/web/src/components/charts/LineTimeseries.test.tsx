import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LineTimeseries } from "./LineTimeseries.js";

const SERIES_A = {
  name: "infer-0",
  samples: [
    [1715212800, 60],
    [1715212815, 75],
  ] as Array<[number, number]>,
};
const SERIES_B = { name: "infer-1", samples: [[1715212800, 50]] as Array<[number, number]> };

describe("<LineTimeseries>", () => {
  it("renders one ECharts series per input series", () => {
    render(<LineTimeseries ariaLabel="qps" series={[SERIES_A, SERIES_B]} unit="%" />);
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}") as {
      series?: unknown[];
    };
    expect(opt.series?.length).toBe(2);
  });

  it("includes markArea on first series when markArea prop is passed", () => {
    render(
      <LineTimeseries
        ariaLabel="latency"
        series={[SERIES_A, SERIES_B]}
        unit="ms"
        markArea={{ from: 1715212800, to: 1715212860 }}
      />,
    );
    const json = screen.getByTestId("echart").dataset.option ?? "{}";
    expect(json).toContain('"markArea"');
    // unix seconds converted to milliseconds
    expect(json).toContain("1715212800000");
    expect(json).toContain("1715212860000");
  });

  it("does not include markArea when markArea prop is omitted", () => {
    render(<LineTimeseries ariaLabel="qps" series={[SERIES_A]} unit="rps" />);
    const json = screen.getByTestId("echart").dataset.option ?? "{}";
    expect(json).not.toContain('"markArea"');
  });

  it("shows loading placeholder when loading=true", () => {
    render(<LineTimeseries ariaLabel="x" series={[SERIES_A]} unit="ms" loading />);
    expect(screen.getByRole("status", { name: "Loading chart" })).toBeInTheDocument();
    expect(screen.queryByTestId("echart")).toBeNull();
  });

  it("shows empty placeholder when series is empty", () => {
    render(<LineTimeseries ariaLabel="x" series={[]} unit="ms" />);
    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.queryByTestId("echart")).toBeNull();
  });

  it("shows custom empty message", () => {
    render(<LineTimeseries ariaLabel="x" series={[]} unit="ms" empty="No metrics yet" />);
    expect(screen.getByText("No metrics yet")).toBeInTheDocument();
  });
});
