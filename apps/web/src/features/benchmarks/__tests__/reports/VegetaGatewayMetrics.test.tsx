import type { Benchmark } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VegetaGatewayMetrics } from "../../reports/vegeta/GatewayMetrics";

const reportData = {
  requests: { total: 600, rate: 10, throughput: 9.8 },
  duration: { totalSeconds: 60, attackSeconds: 60, waitSeconds: 0 },
  latencies: { min: 5, mean: 25.4, p50: 22, p90: 38, p95: 45.6, p99: 80, max: 120 },
  bytesIn: { total: 1024000, mean: 1706 },
  bytesOut: { total: 200000, mean: 333 },
  success: 99.5,
  statusCodes: { "200": 597, "500": 3 },
  errors: ["timeout", "connection refused"],
};

function makeBenchmark(
  overrides: Partial<Benchmark> = {},
  reportOverride?: typeof reportData,
): Benchmark {
  return {
    id: "r1",
    userId: "u1",
    connectionId: "c1",
    connection: { id: "c1", name: "gateway" },
    scenario: "gateway",
    tool: "vegeta",
    toolVersion: null,
    name: "smoke",
    description: null,
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: { tool: "vegeta", data: reportOverride ?? reportData },
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

describe("VegetaGatewayMetrics", () => {
  it("renders requests, latency dist, success%, status codes", () => {
    render(<VegetaGatewayMetrics benchmark={makeBenchmark()} />);
    expect(screen.getByText(/600/)).toBeInTheDocument();
    expect(screen.getByText(/45.6/)).toBeInTheDocument();
    expect(screen.getByText(/99.5/)).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText("597")).toBeInTheDocument();
  });

  it("lists errors when present", () => {
    render(<VegetaGatewayMetrics benchmark={makeBenchmark()} />);
    expect(screen.getByText(/timeout/i)).toBeInTheDocument();
    expect(screen.getByText(/connection refused/i)).toBeInTheDocument();
  });

  it("hides errors section when array empty", () => {
    render(<VegetaGatewayMetrics benchmark={makeBenchmark({}, { ...reportData, errors: [] })} />);
    expect(screen.queryByText(/Errors/i)).not.toBeInTheDocument();
  });
});
