import type { GuidellmReport } from "@modeldoctor/tool-adapters/schemas";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GuidellmReportView } from "../../reports/GuidellmReportView";

const fixture: GuidellmReport = {
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

describe("GuidellmReportView", () => {
  it("renders all primary distribution rows", () => {
    render(<GuidellmReportView data={fixture} />);
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
});
