import type { BenchmarkChartsResponse } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { ApiError, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});

// ECharts uses canvas APIs not present in jsdom; stub the chart components.
vi.mock("@/components/charts", () => ({
  LatencyCDF: (props: { ariaLabel?: string; series: unknown[] }) => (
    <div
      data-testid="latency-cdf"
      data-aria={props.ariaLabel}
      data-series-count={props.series.length}
    />
  ),
  TTFTHistogram: (props: { ariaLabel?: string; series: unknown[] }) => (
    <div
      data-testid="ttft-histogram"
      data-aria={props.ariaLabel}
      data-series-count={props.series.length}
    />
  ),
  assignRunColors: () => ({}),
}));

import { api } from "@/lib/api-client";
import { BenchmarkChartsSection } from "../BenchmarkChartsSection";

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("BenchmarkChartsSection", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("renders both charts for guidellm benchmark with full data", async () => {
    const data: BenchmarkChartsResponse = {
      latencyCdf: { samples: [10, 20, 30] },
      ttftHistogram: {
        buckets: [
          { lower: 0, upper: 10, count: 3 },
          { lower: 10, upper: 20, count: 5 },
        ],
      },
    };
    vi.mocked(api.get).mockResolvedValueOnce(data);
    render(<BenchmarkChartsSection benchmarkId="r1" tool="guidellm" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId("ttft-histogram")).toBeInTheDocument());
    expect(screen.getByTestId("latency-cdf")).toBeInTheDocument();
    expect(screen.getByTestId("latency-cdf").getAttribute("data-series-count")).toBe("1");
    expect(screen.getByTestId("ttft-histogram").getAttribute("data-series-count")).toBe("1");
  });

  it("renders only LatencyCDF for vegeta benchmark (no TTFT)", async () => {
    const data: BenchmarkChartsResponse = {
      latencyCdf: { samples: [5, 10, 15] },
      ttftHistogram: null,
    };
    vi.mocked(api.get).mockResolvedValueOnce(data);
    render(<BenchmarkChartsSection benchmarkId="r2" tool="vegeta" />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByTestId("latency-cdf").getAttribute("data-series-count")).toBe("1"),
    );
    expect(screen.queryByTestId("ttft-histogram")).not.toBeInTheDocument();
  });

  it("renders empty state when latencyCdf is null and tool has no other chart", async () => {
    const data: BenchmarkChartsResponse = { latencyCdf: null, ttftHistogram: null };
    vi.mocked(api.get).mockResolvedValueOnce(data);
    render(<BenchmarkChartsSection benchmarkId="r3" tool="vegeta" />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText(/No chart data|暂无图表数据/i)).toBeInTheDocument(),
    );
  });

  it("renders error state when the endpoint rejects", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("boom"));
    render(<BenchmarkChartsSection benchmarkId="r4" tool="guidellm" />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText(/Failed to load charts|图表加载失败/i)).toBeInTheDocument(),
    );
  });
});
