import type { Run } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import { CompareGrid } from "../CompareGrid";

function makeGuidellmRun(id: string, p95: number): Run {
  return {
    id,
    userId: null,
    connectionId: null,
    connection: null,
    kind: "benchmark",
    tool: "guidellm",
    scenario: {},
    mode: "fixed",
    driverKind: "local",
    name: id,
    description: null,
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: {
      tool: "guidellm",
      data: {
        e2eLatency: { mean: 100, p50: 95, p90: 130, p95, p99: 600 },
        ttft: { mean: 80, p50: 75, p90: 100, p95: 150, p99: 200 },
        itl: { mean: 5, p50: 5, p90: 6, p95: 7, p99: 8 },
        requestsPerSecond: { mean: 10 },
        requests: { total: 100, success: 100, error: 0, incomplete: 0 },
      },
    } as unknown as Run["summaryMetrics"],
    serverMetrics: null,
    templateId: null,
    templateVersion: null,
    parentRunId: null,
    baselineId: null,
    baselineFor: null,
    logs: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
  };
}

describe("CompareGrid", () => {
  it("renders one column per run plus the metric label column", () => {
    const runs = [makeGuidellmRun("a", 200), makeGuidellmRun("b", 240)];
    render(<CompareGrid runs={runs} baselineId="a" />);
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
  });

  it("highlights the baseline column header", () => {
    const runs = [makeGuidellmRun("a", 200), makeGuidellmRun("b", 240)];
    const { container } = render(<CompareGrid runs={runs} baselineId="a" />);
    // Find the th matching "a" and check its classes
    const headers = container.querySelectorAll("th");
    const aHeader = Array.from(headers).find((h) => h.textContent === "a");
    expect(aHeader?.className).toMatch(/amber|bg-/);
  });

  it("renders no verdict badges when baselineId is null", () => {
    const runs = [makeGuidellmRun("a", 200), makeGuidellmRun("b", 240)];
    const { container } = render(<CompareGrid runs={runs} baselineId={null} />);
    // No svg icons from VerdictBadge
    const tableSvgs = container.querySelectorAll("table svg");
    expect(tableSvgs.length).toBe(0);
  });

  it("re-renders verdicts when baselineId changes", () => {
    const runs = [makeGuidellmRun("a", 200), makeGuidellmRun("b", 240)];
    const { rerender, container } = render(<CompareGrid runs={runs} baselineId="a" />);
    expect(container.querySelectorAll("table svg").length).toBeGreaterThan(0);

    rerender(<CompareGrid runs={runs} baselineId={null} />);
    expect(container.querySelectorAll("table svg").length).toBe(0);
  });
});
