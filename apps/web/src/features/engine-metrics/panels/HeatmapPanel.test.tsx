import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HeatmapPanel } from "./HeatmapPanel.js";

vi.mock("echarts-for-react", () => ({
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echart" data-option={JSON.stringify(option)} />
  ),
}));

describe("<HeatmapPanel>", () => {
  it("renders one stacked-bar series per histogram bucket label", () => {
    render(
      <HeatmapPanel
        label="request_length"
        series={[
          { label: "+Inf", samples: [[100, 5]] },
          { label: "1000", samples: [[100, 8]] },
        ]}
        unavailable={false}
      />,
    );
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}");
    const json = JSON.stringify(opt);
    expect(json).toContain('"stack":"hist"');
    expect(json).toContain("+Inf");
  });

  it("renders unavailable placeholder", () => {
    render(<HeatmapPanel label="x" series={[]} unavailable reason="no_data" />);
    expect(screen.queryByTestId("echart")).toBeNull();
  });
});
