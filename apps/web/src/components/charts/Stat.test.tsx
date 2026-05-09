import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Stat } from "./Stat.js";

describe("<Stat>", () => {
  it("renders formatted value", () => {
    render(<Stat ariaLabel="ttft" value={187.4} unit="ms" />);
    expect(screen.getByText("187 ms")).toBeInTheDocument();
  });

  it("applies crit color class when below warn threshold", () => {
    render(
      <Stat
        ariaLabel="success_rate"
        value={0.85}
        unit="ratio"
        thresholds={[
          { at: 0.95, severity: "ok" },
          { at: 0.9, severity: "warn" },
          { at: 0, severity: "crit" },
        ]}
      />,
    );
    const el = screen.getByText("85.0%");
    expect(el.className).toMatch(/text-rose-500/);
  });

  it("applies warn color class when between warn and ok thresholds", () => {
    render(
      <Stat
        ariaLabel="success_rate"
        value={0.92}
        unit="ratio"
        thresholds={[
          { at: 0.95, severity: "ok" },
          { at: 0.9, severity: "warn" },
          { at: 0, severity: "crit" },
        ]}
      />,
    );
    const el = screen.getByText("92.0%");
    expect(el.className).toMatch(/text-amber-500/);
  });

  it("applies ok color class when above ok threshold", () => {
    render(
      <Stat
        ariaLabel="success_rate"
        value={0.97}
        unit="ratio"
        thresholds={[
          { at: 0.95, severity: "ok" },
          { at: 0.9, severity: "warn" },
          { at: 0, severity: "crit" },
        ]}
      />,
    );
    const el = screen.getByText("97.0%");
    expect(el.className).toMatch(/text-emerald-500/);
  });

  it("shows loading placeholder when loading=true", () => {
    render(<Stat ariaLabel="ttft" value={100} unit="ms" loading />);
    expect(screen.getByRole("status", { name: "Loading chart" })).toBeInTheDocument();
    expect(screen.queryByText(/ms/)).toBeNull();
  });

  it("shows empty placeholder when empty=true", () => {
    render(<Stat ariaLabel="ttft" value={null} unit="ms" empty="No data available" />);
    expect(screen.getByText("No data available")).toBeInTheDocument();
  });

  it("shows default empty placeholder when value is null", () => {
    render(<Stat ariaLabel="ttft" value={null} unit="ms" />);
    expect(screen.getByText("No data")).toBeInTheDocument();
  });
});
