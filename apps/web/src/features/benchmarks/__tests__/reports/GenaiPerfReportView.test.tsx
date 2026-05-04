import type { GenaiPerfReport } from "@modeldoctor/tool-adapters/schemas";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GenaiPerfReportView } from "../../reports/GenaiPerfReportView";

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

const fixture: GenaiPerfReport = {
  requestThroughput: { avg: 50.2, unit: "req/s" },
  requestLatency: dist,
  timeToFirstToken: dist,
  interTokenLatency: { ...dist, avg: 5.1 },
  outputTokenThroughput: { avg: 1200, unit: "tok/s" },
  outputSequenceLength: { avg: 256, p50: 250, p99: 400 },
  inputSequenceLength: { avg: 128, p50: 120, p99: 200 },
};

describe("GenaiPerfReportView", () => {
  it("renders throughput + latency + sequence-length cards", () => {
    render(<GenaiPerfReportView data={fixture} />);
    expect(screen.getByText(/50.2/)).toBeInTheDocument();
    // requestLatency and timeToFirstToken both have avg 12.5 → multiple elements
    expect(screen.getAllByText(/12.5/).length).toBeGreaterThan(0);
    expect(screen.getByText(/5.1/)).toBeInTheDocument();
    expect(screen.getByText(/1200/)).toBeInTheDocument();
    expect(screen.getByText(/256/)).toBeInTheDocument();
    expect(screen.getByText(/128/)).toBeInTheDocument();
  });
});
