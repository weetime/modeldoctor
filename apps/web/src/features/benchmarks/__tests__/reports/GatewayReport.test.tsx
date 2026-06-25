import type { Benchmark } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GatewayReport } from "../../reports/GatewayReport";

const vegetaReport = {
  requests: { total: 600, rate: 10, throughput: 9.8 },
  duration: { totalSeconds: 60, attackSeconds: 60, waitSeconds: 0 },
  latencies: { min: 5, mean: 25.4, p50: 22, p90: 38, p95: 45.6, p99: 80, max: 120 },
  bytesIn: { total: 1024000, mean: 1706 },
  bytesOut: { total: 200000, mean: 333 },
  success: 99.5,
  statusCodes: { "200": 597, "500": 3 },
  errors: [],
};

function makeBenchmark(overrides: Partial<Benchmark> = {}): Benchmark {
  return {
    id: "r1",
    userId: "u1",
    connectionId: "c1",
    connection: { id: "c1", name: "gateway", model: "m", baseUrl: "http://x" },
    scenario: "gateway",
    tool: "vegeta",
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
    summaryMetrics: { tool: "vegeta", data: vegetaReport },
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

describe("GatewayReport", () => {
  it("renders the Vegeta gateway metrics for tool=vegeta", () => {
    render(<GatewayReport benchmark={makeBenchmark()} />);
    expect(screen.getByText(/Status codes/i)).toBeInTheDocument();
  });

  it("falls back to UnknownReport for non-vegeta tool", () => {
    render(
      <GatewayReport
        benchmark={makeBenchmark({
          tool: "guidellm",
          summaryMetrics: { tool: "guidellm", data: {} },
        })}
      />,
    );
    expect(screen.getByText(/Report shape not recognized/i)).toBeInTheDocument();
  });
});
