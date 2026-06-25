import "@/lib/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { type ReportRun, ReportSections } from "./ReportSections";

const summaryMetrics = (qps: number) => ({
  tool: "guidellm",
  data: {
    ttft: { p50: 100, p95: 350, p99: 500 },
    e2eLatency: { p50: 800, p95: 2000, p99: 3000 },
    requestsPerSecond: { mean: qps },
    requests: { total: 1000, error: 0 },
  },
});

function run(id: string, stageLabel: string): ReportRun {
  return {
    id,
    stageLabel,
    tool: "guidellm",
    scenario: "inference",
    summaryMetrics: summaryMetrics(3),
    serverMetrics: null,
    benchmark: {
      id,
      name: `bench-${id}`,
      tool: "guidellm",
      scenario: "inference",
      summaryMetrics: summaryMetrics(3),
      serverMetrics: null,
    },
    paramsSummary: { concurrency: 10 },
  };
}

function renderMatrix(onRelabel?: (id: string, value: string) => void) {
  return render(
    <MemoryRouter>
      <ReportSections
        runs={[run("a", "OFF"), run("b", "ON")]}
        baselineId={null}
        onRelabel={onRelabel}
      />
    </MemoryRouter>,
  );
}

describe("ReportSections inline stage-label editing (#326)", () => {
  it("renders labels as plain text when onRelabel is absent", () => {
    render(
      <MemoryRouter>
        <ReportSections runs={[run("a", "OFF"), run("b", "ON")]} baselineId={null} />
      </MemoryRouter>,
    );
    // No edit buttons — labels are inert.
    expect(screen.queryByTitle(/Edit stage label/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("OFF").length).toBeGreaterThan(0);
  });

  it("commits a renamed label on Enter", () => {
    const onRelabel = vi.fn();
    renderMatrix(onRelabel);
    fireEvent.click(screen.getAllByTitle(/Edit stage label/i)[0]);
    const input = screen.getByLabelText(/Edit stage label/i);
    fireEvent.change(input, { target: { value: "Baseline" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRelabel).toHaveBeenCalledWith("a", "Baseline");
  });

  it("reverts to auto label on an empty commit", () => {
    const onRelabel = vi.fn();
    renderMatrix(onRelabel);
    fireEvent.click(screen.getAllByTitle(/Edit stage label/i)[0]);
    const input = screen.getByLabelText(/Edit stage label/i);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRelabel).toHaveBeenCalledWith("a", "");
  });

  it("cancels on Escape without committing", () => {
    const onRelabel = vi.fn();
    renderMatrix(onRelabel);
    fireEvent.click(screen.getAllByTitle(/Edit stage label/i)[0]);
    const input = screen.getByLabelText(/Edit stage label/i);
    fireEvent.change(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRelabel).not.toHaveBeenCalled();
  });

  it("does not fire onRelabel when the value is unchanged", () => {
    const onRelabel = vi.fn();
    renderMatrix(onRelabel);
    fireEvent.click(screen.getAllByTitle(/Edit stage label/i)[0]);
    const input = screen.getByLabelText(/Edit stage label/i);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRelabel).not.toHaveBeenCalled();
  });
});
