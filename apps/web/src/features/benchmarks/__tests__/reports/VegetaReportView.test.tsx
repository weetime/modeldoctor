import type { VegetaReport } from "@modeldoctor/tool-adapters/schemas";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VegetaReportView } from "../../reports/VegetaReportView";

const fixture: VegetaReport = {
  requests: { total: 600, rate: 10, throughput: 9.8 },
  duration: { totalSeconds: 60, attackSeconds: 60, waitSeconds: 0 },
  latencies: { min: 5, mean: 25.4, p50: 22, p90: 38, p95: 45.6, p99: 80, max: 120 },
  bytesIn: { total: 1024000, mean: 1706 },
  bytesOut: { total: 200000, mean: 333 },
  success: 99.5,
  statusCodes: { "200": 597, "500": 3 },
  errors: ["timeout", "connection refused"],
};

describe("VegetaReportView", () => {
  it("renders requests, latency dist, success%, status codes", () => {
    render(<VegetaReportView data={fixture} />);
    expect(screen.getByText(/600/)).toBeInTheDocument();
    expect(screen.getByText(/45.6/)).toBeInTheDocument();
    expect(screen.getByText(/99.5/)).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText("597")).toBeInTheDocument();
  });

  it("lists errors when present", () => {
    render(<VegetaReportView data={fixture} />);
    expect(screen.getByText(/timeout/i)).toBeInTheDocument();
    expect(screen.getByText(/connection refused/i)).toBeInTheDocument();
  });

  it("hides errors section when array empty", () => {
    render(<VegetaReportView data={{ ...fixture, errors: [] }} />);
    expect(screen.queryByText(/Errors/i)).not.toBeInTheDocument();
  });
});
