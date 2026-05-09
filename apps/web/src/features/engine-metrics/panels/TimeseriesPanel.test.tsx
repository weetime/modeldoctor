import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimeseriesPanel } from "./TimeseriesPanel.js";

vi.mock("echarts-for-react", () => ({
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echart" data-option={JSON.stringify(option)} />
  ),
}));

describe("<TimeseriesPanel>", () => {
  it("renders one line per series", () => {
    render(
      <TimeseriesPanel
        label="kv_cache_usage"
        unit="%"
        series={[
          { label: "infer-0", samples: [[1715212800, 60], [1715212815, 75]] },
          { label: "infer-1", samples: [[1715212800, 50]] },
        ]}
        unavailable={false}
        benchmarkWindow={{ from: 1715212800, to: 1715212820 }}
      />,
    );
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}");
    const seriesArr = (opt as { series?: unknown[] }).series ?? [];
    expect(seriesArr.length).toBeGreaterThanOrEqual(2);
  });

  it("includes a markArea spanning the benchmark window", () => {
    render(
      <TimeseriesPanel
        label="x"
        unit="ms"
        series={[{ samples: [[1715212800, 1]] }]}
        unavailable={false}
        benchmarkWindow={{ from: 1715212800, to: 1715212860 }}
      />,
    );
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}");
    const json = JSON.stringify(opt);
    expect(json).toContain("markArea");
    expect(json).toContain("1715212800000"); // ms-converted
    expect(json).toContain("1715212860000");
  });

  it("renders unavailable placeholder", () => {
    render(
      <TimeseriesPanel
        label="x"
        unit="count"
        series={[]}
        unavailable
        reason="no_data"
        benchmarkWindow={{ from: 0, to: 60 }}
      />,
    );
    expect(screen.queryByTestId("echart")).toBeNull();
  });
});
