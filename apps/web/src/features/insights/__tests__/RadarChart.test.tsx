import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RadarChart } from "../RadarChart";

describe("RadarChart", () => {
  it("renders 6 axis spokes", () => {
    const { container } = render(<RadarChart values={{}} />);
    const spokes = container.querySelectorAll("[data-axis]");
    expect(spokes.length).toBe(6);
  });

  it("draws polygon for non-null axis values", () => {
    const { container } = render(
      <RadarChart values={{ responsiveness: 0.8, throughput: 0.5, stability: 1.0 }} />,
    );
    const poly = container.querySelector("polygon[data-role='value-shape']");
    expect(poly).toBeTruthy();
    // points attribute should be a non-empty space-separated list
    expect(poly?.getAttribute("points")?.split(" ").length).toBeGreaterThan(2);
  });

  it("renders axis labels at the spoke ends", () => {
    const { getAllByRole } = render(<RadarChart values={{}} />);
    // labels are <text> elements; jsdom exposes role=img on svg
    const svg = getAllByRole("img")[0];
    expect(svg.querySelectorAll("text").length).toBeGreaterThanOrEqual(6);
  });
});
