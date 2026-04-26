import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import { BenchmarkMetricsGrid } from "../BenchmarkMetricsGrid";
import type { BenchmarkMetricsSummary } from "@modeldoctor/contracts";

const SUMMARY: BenchmarkMetricsSummary = {
  ttft: { mean: 142, p50: 137, p95: 198, p99: 240 },
  itl: { mean: 14.2, p50: 13.8, p95: 18.4, p99: 22.1 },
  e2eLatency: { mean: 1200, p50: 1180, p95: 1500, p99: 1800 },
  requestsPerSecond: { mean: 8.4 },
  outputTokensPerSecond: { mean: 142.3 },
  inputTokensPerSecond: { mean: 1024 },
  totalTokensPerSecond: { mean: 1166.3 },
  concurrency: { mean: 12.1, max: 32 },
  requests: { total: 1000, success: 998, error: 2, incomplete: 0 },
};

describe("BenchmarkMetricsGrid", () => {
  it("renders all 12 tile labels", () => {
    render(<BenchmarkMetricsGrid summary={SUMMARY} />);
    expect(screen.getByText(/TTFT mean/i)).toBeInTheDocument();
    expect(screen.getByText(/TTFT p95/i)).toBeInTheDocument();
    expect(screen.getByText(/TTFT p99/i)).toBeInTheDocument();
    expect(screen.getByText(/ITL mean/i)).toBeInTheDocument();
    expect(screen.getByText(/ITL p95/i)).toBeInTheDocument();
    expect(screen.getByText(/ITL p99/i)).toBeInTheDocument();
    expect(screen.getByText(/Output tok\/s/i)).toBeInTheDocument();
    expect(screen.getByText(/Requests\/s/i)).toBeInTheDocument();
    expect(screen.getByText(/Concurrency mean/i)).toBeInTheDocument();
    expect(screen.getByText(/Concurrency max/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Success/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Errors?/i).length).toBeGreaterThan(0);
  });

  it("mean tile carries p50/p95/p99 subtitle", () => {
    render(<BenchmarkMetricsGrid summary={SUMMARY} />);
    expect(screen.getByText(/p50 137/)).toBeInTheDocument();
    expect(screen.getByText(/p95 198/)).toBeInTheDocument();
    expect(screen.getByText(/p99 240/)).toBeInTheDocument();
  });

  it("renders em dashes when summary is null", () => {
    render(<BenchmarkMetricsGrid summary={null} />);
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(12);
  });
});
