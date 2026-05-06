import type { Benchmark } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UnknownReport } from "../../reports/UnknownReport";

function makeBenchmark(overrides: Partial<Benchmark> = {}): Benchmark {
  return {
    id: "r1",
    userId: "u1",
    connectionId: "c1",
    connection: { id: "c1", name: "vLLM Local" },
    scenario: "inference",
    tool: "guidellm",
    toolVersion: null,
    name: "smoke",
    description: null,
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: { tool: "future-tool", data: { x: 1 } },
    serverMetrics: null,
    templateId: null,
    parentBenchmarkId: null,
    baselineId: null,
    baselineFor: null,
    logs: null,
    createdAt: "2026-04-30T12:00:00.000Z",
    startedAt: "2026-04-30T12:00:01.000Z",
    completedAt: "2026-04-30T12:00:30.000Z",
    ...overrides,
  };
}

describe("UnknownReport", () => {
  it("renders scenario/tool routing explanation and pretty-printed JSON", () => {
    render(<UnknownReport benchmark={makeBenchmark()} />);
    expect(screen.getByText(/Report shape not recognized/i)).toBeInTheDocument();
    expect(screen.getByText(/scenario=inference/)).toBeInTheDocument();
    expect(screen.getByText(/tool=guidellm/)).toBeInTheDocument();
    expect(screen.getByText(/"future-tool"/)).toBeInTheDocument();
  });

  it("renders an optional parse-error reason when supplied", () => {
    render(<UnknownReport benchmark={makeBenchmark()} reason="zod parse failed at .ttft" />);
    expect(screen.getByText(/zod parse failed at \.ttft/)).toBeInTheDocument();
  });

  it("survives null summaryMetrics", () => {
    render(<UnknownReport benchmark={makeBenchmark({ summaryMetrics: null })} />);
    expect(screen.getByText(/Report shape not recognized/i)).toBeInTheDocument();
    expect(screen.getByText("null")).toBeInTheDocument();
  });
});
