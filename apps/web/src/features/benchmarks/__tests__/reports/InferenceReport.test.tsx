import type { Benchmark } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InferenceReport } from "../../reports/InferenceReport";

const guidellmReport = {
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

const genaiPerfDist = {
  avg: 12.5,
  min: 10,
  max: 30,
  p50: 12,
  p90: 18,
  p95: 22,
  p99: 28,
  stddev: 4,
  unit: "ms",
};

const genaiPerfReport = {
  requestThroughput: { avg: 50.2, unit: "req/s" },
  requestLatency: genaiPerfDist,
  timeToFirstToken: genaiPerfDist,
  interTokenLatency: { ...genaiPerfDist, avg: 5.1 },
  outputTokenThroughput: { avg: 1200, unit: "tok/s" },
  outputSequenceLength: { avg: 256, p50: 250, p99: 400 },
  inputSequenceLength: { avg: 128, p50: 120, p99: 200 },
};

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
    summaryMetrics: { tool: "guidellm", data: guidellmReport },
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

describe("InferenceReport", () => {
  it("dispatches to GuidellmInferenceMetrics for tool=guidellm", () => {
    render(<InferenceReport benchmark={makeBenchmark()} />);
    // TTFT is a guidellm-only label; presence proves we routed to the guidellm metrics block.
    expect(screen.getByText(/TTFT \(ms\)/)).toBeInTheDocument();
  });

  it("dispatches to GenaiPerfInferenceMetrics for tool=genai-perf", () => {
    render(
      <InferenceReport
        benchmark={makeBenchmark({
          tool: "genai-perf",
          summaryMetrics: { tool: "genai-perf", data: genaiPerfReport },
        })}
      />,
    );
    // "Sequence length" is a genai-perf-only card title.
    expect(screen.getByText(/Sequence length/)).toBeInTheDocument();
  });

  it("falls back to UnknownReport for unsupported tool", () => {
    render(
      <InferenceReport
        benchmark={makeBenchmark({
          tool: "vegeta",
          summaryMetrics: { tool: "vegeta", data: {} },
        })}
      />,
    );
    expect(screen.getByText(/Report shape not recognized/i)).toBeInTheDocument();
  });
});
