import type { Benchmark } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GenaiPerfInferenceMetrics } from "../../reports/genai-perf/InferenceMetrics";

const dist = {
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

const reportData = {
  requestThroughput: { avg: 50.2, unit: "req/s" },
  requestLatency: dist,
  timeToFirstToken: dist,
  interTokenLatency: { ...dist, avg: 5.1 },
  outputTokenThroughput: { avg: 1200, unit: "tok/s" },
  outputSequenceLength: { avg: 256, p50: 250, p99: 400 },
  inputSequenceLength: { avg: 128, p50: 120, p99: 200 },
};

function makeBenchmark(overrides: Partial<Benchmark> = {}): Benchmark {
  return {
    id: "r1",
    userId: "u1",
    connectionId: "c1",
    connection: { id: "c1", name: "vLLM Local", model: "m", baseUrl: "http://x" },
    scenario: "inference",
    tool: "genai-perf",
    toolVersion: null,
    name: "smoke",
    description: null,
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: { tool: "genai-perf", data: reportData },
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

describe("GenaiPerfInferenceMetrics", () => {
  it("renders throughput + latency + sequence-length cards", () => {
    render(<GenaiPerfInferenceMetrics benchmark={makeBenchmark()} />);
    // requestThroughput.avg = 50.2 rps → Stat formats as "50.2 rps"
    expect(screen.getByText(/50\.2/)).toBeInTheDocument();
    // requestLatency and timeToFirstToken both have avg 12.5 → multiple elements
    expect(screen.getAllByText(/12.5/).length).toBeGreaterThan(0);
    expect(screen.getByText(/5.1/)).toBeInTheDocument();
    // outputTokenThroughput.avg = 1200 → formatPanelValue tps abbreviates to "1.2k tps"
    expect(screen.getByText(/1\.2k/)).toBeInTheDocument();
    expect(screen.getByText(/256/)).toBeInTheDocument();
    expect(screen.getByText(/128/)).toBeInTheDocument();
  });
});
