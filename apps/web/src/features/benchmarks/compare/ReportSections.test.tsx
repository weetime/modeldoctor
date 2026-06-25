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
  it("renders labels as plain text (no inputs) when onRelabel is absent", () => {
    render(
      <MemoryRouter>
        <ReportSections runs={[run("a", "OFF"), run("b", "ON")]} baselineId={null} />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText(/Stage label/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("OFF").length).toBeGreaterThan(0);
  });

  it("renders one always-on input per run, seeded from the current label", () => {
    renderMatrix(vi.fn());
    const inputs = screen.getAllByLabelText(/Stage label/i);
    expect(inputs).toHaveLength(2);
    expect((inputs[0] as HTMLInputElement).value).toBe("OFF");
    expect((inputs[1] as HTMLInputElement).value).toBe("ON");
  });

  it("reports the raw value on every keystroke", () => {
    const onRelabel = vi.fn();
    renderMatrix(onRelabel);
    const input = screen.getByDisplayValue("OFF");
    fireEvent.change(input, { target: { value: "Baseline" } });
    expect(onRelabel).toHaveBeenCalledWith("a", "Baseline");
  });

  it("reports an empty value as-is (clearable, not reverted)", () => {
    const onRelabel = vi.fn();
    renderMatrix(onRelabel);
    const input = screen.getByDisplayValue("ON");
    fireEvent.change(input, { target: { value: "" } });
    expect(onRelabel).toHaveBeenCalledWith("b", "");
  });
});
