import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GaugePanel } from "./GaugePanel.js";

vi.mock("echarts-for-react", () => ({
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echart" data-option={JSON.stringify(option)} />
  ),
}));

describe("<GaugePanel>", () => {
  it("renders with the latest value", () => {
    render(
      <GaugePanel
        label="prefix_cache_hit_rate"
        unit="%"
        series={[{ samples: [[1, 95]] }]}
        unavailable={false}
      />,
    );
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}");
    expect(JSON.stringify(opt)).toContain("95");
  });

  it("renders unavailable placeholder", () => {
    render(<GaugePanel label="x" unit="count" series={[]} unavailable reason="no_data" />);
    expect(screen.queryByTestId("echart")).toBeNull();
  });
});
