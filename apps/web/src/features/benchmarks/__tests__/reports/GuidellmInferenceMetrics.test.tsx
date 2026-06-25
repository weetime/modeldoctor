import type { Benchmark } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GuidellmInferenceMetrics } from "../../reports/guidellm/InferenceMetrics";

const reportData = {
  ttft: { mean: 12.3, p50: 11, p90: 14, p95: 18, p99: 25 },
  itl: { mean: 5.2, p50: 5, p90: 6, p95: 7, p99: 8 },
  e2eLatency: { mean: 100, p50: 95, p90: 130, p95: 150, p99: 200 },
  requestsPerSecond: { mean: 42.5 },
  outputTokensPerSecond: { mean: 1500 },
  inputTokensPerSecond: { mean: 800 },
  totalTokensPerSecond: { mean: 2300 },
  concurrency: { mean: 16, max: 24 },
  requests: { total: 1000, success: 985, error: 10, incomplete: 5 },
};

function makeBenchmark(overrides: Partial<Benchmark> = {}): Benchmark {
  return {
    id: "r1",
    userId: "u1",
    connectionId: "c1",
    connection: { id: "c1", name: "vLLM Local", model: "m", baseUrl: "http://x" },
    scenario: "inference",
    tool: "guidellm",
    toolVersion: null,
    name: "smoke",
    label: null,
    description: null,
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: { tool: "guidellm", data: reportData },
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

describe("GuidellmInferenceMetrics", () => {
  it("renders all primary distribution rows", () => {
    render(<GuidellmInferenceMetrics benchmark={makeBenchmark()} />);
    // TTFT mean
    expect(screen.getByText(/12.3/)).toBeInTheDocument();
    // E2E p99
    expect(screen.getByText(/200/)).toBeInTheDocument();
    // Throughput mean
    expect(screen.getByText(/42.5/)).toBeInTheDocument();
    // Requests success / total
    expect(screen.getByText(/985/)).toBeInTheDocument();
    expect(screen.getByText(/1000/)).toBeInTheDocument();
  });

  it("falls back to UnknownReport when summaryMetrics.data fails to parse", () => {
    render(
      <GuidellmInferenceMetrics
        benchmark={makeBenchmark({
          summaryMetrics: { tool: "guidellm", data: { not: "a guidellm report" } },
        })}
      />,
    );
    expect(screen.getByText(/Report shape not recognized/i)).toBeInTheDocument();
  });
});
