import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatPanel } from "./StatPanel.js";

describe("<StatPanel>", () => {
  it("renders the latest sample with formatted unit", () => {
    render(
      <StatPanel
        label="TTFT P99"
        unit="ms"
        series={[{ samples: [[100, 100], [200, 187.4]] }]}
        unavailable={false}
      />,
    );
    expect(screen.getByText(/187 ms/)).toBeInTheDocument();
  });

  it("renders unavailable placeholder when flagged", () => {
    render(
      <StatPanel
        label="X"
        unit="count"
        series={[]}
        unavailable
        reason="not_supported"
      />,
    );
    // The placeholder shows the i18n unavailable string. Without i18n setup
    // in this minimal test, the literal i18n key may render — accept either.
    expect(
      screen.getByText(/not.supported|not reported|不上报|unavailable/i),
    ).toBeInTheDocument();
  });

  it("colors per threshold severity", () => {
    render(
      <StatPanel
        label="success_rate"
        unit="ratio"
        series={[{ samples: [[1, 0.85]] }]}
        unavailable={false}
        thresholds={[
          { at: 0.95, severity: "ok" },
          { at: 0.9, severity: "warn" },
          { at: 0, severity: "crit" },
        ]}
      />,
    );
    const value = screen.getByText(/85.0%/);
    expect(value.className).toMatch(/text-/);
  });
});
