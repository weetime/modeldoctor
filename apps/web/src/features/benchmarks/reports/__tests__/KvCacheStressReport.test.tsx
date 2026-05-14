import type { Benchmark } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

// Stub the api-client so useBenchmarkList (used for cold/warm sibling lookup)
// doesn't hit a real network during the test.
vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    api: {
      get: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      post: vi.fn(),
      patch: vi.fn(),
      del: vi.fn(),
    },
  };
});

import { KvCacheStressReport } from "../KvCacheStressReport";

function wrap(children: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const baseData = {
  throughput: {
    requestsPerSec: 8,
    outputTokensPerSec: 1200,
    totalTokensPerSec: 1500,
  },
  ttft: { mean: 800, p50: 700, p90: 1200, p95: 1500, p99: 2000 },
  e2eLatency: { mean: 4000, p50: 3500, p90: 5500, p95: 6500, p99: 8000 },
  itl: { mean: 30, p50: 28, p90: 40, p95: 45, p99: 60 },
  requests: { total: 64, success: 64, error: 0, errorRate: 0 },
  prefixCacheStats: { hitRate: 0.85 },
};

const baseBenchmark = {
  id: "b1",
  name: "KV Cache · Task 1",
  tool: "evalscope",
  scenario: "kv-cache-stress",
  status: "completed",
  summaryMetrics: { tool: "evalscope", data: baseData },
} as unknown as Benchmark;

describe("KvCacheStressReport", () => {
  it("renders prefix cache panel when stats are present", () => {
    render(wrap(<KvCacheStressReport benchmark={baseBenchmark} />));
    expect(screen.getByText(/Prefix cache/i)).toBeInTheDocument();
    expect(screen.getByText(/85\.0%/)).toBeInTheDocument();
  });

  it("hides prefix cache panel when stats are absent", () => {
    const { prefixCacheStats: _drop, ...dataNoPrefix } = baseData;
    const bm = {
      ...baseBenchmark,
      summaryMetrics: { tool: "evalscope", data: dataNoPrefix },
    } as unknown as Benchmark;
    render(wrap(<KvCacheStressReport benchmark={bm} />));
    expect(screen.queryByText(/Prefix cache/i)).not.toBeInTheDocument();
  });
});
