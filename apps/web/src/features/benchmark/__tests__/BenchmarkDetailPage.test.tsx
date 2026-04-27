import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
  return { ApiError, api: { get: vi.fn(), post: vi.fn(), del: vi.fn() } };
});

import { api } from "@/lib/api-client";
import type { BenchmarkRun } from "@modeldoctor/contracts";
import { BenchmarkDetailPage } from "../BenchmarkDetailPage";

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/benchmarks/r1"]}>
        <Routes>
          <Route path="/benchmarks/:id" element={children} />
          <Route path="/benchmarks" element={<div>list</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const BASE: BenchmarkRun = {
  id: "r1",
  userId: "u1",
  name: "smoke",
  description: null,
  profile: "throughput",
  apiType: "chat",
  apiUrl: "https://api.test/v1",
  model: "m",
  datasetName: "random",
  datasetInputTokens: 1024,
  datasetOutputTokens: 128,
  datasetSeed: null,
  requestRate: 0,
  totalRequests: 1000,
  state: "completed",
  stateMessage: null,
  jobName: "benchmark-r1",
  progress: 1,
  metricsSummary: {
    ttft: { mean: 142, p50: 137, p95: 198, p99: 240 },
    itl: { mean: 14, p50: 13, p95: 18, p99: 22 },
    e2eLatency: { mean: 1200, p50: 1180, p95: 1500, p99: 1800 },
    requestsPerSecond: { mean: 8.4 },
    outputTokensPerSecond: { mean: 142.3 },
    inputTokensPerSecond: { mean: 1024 },
    totalTokensPerSecond: { mean: 1166.3 },
    concurrency: { mean: 12, max: 32 },
    requests: { total: 1000, success: 998, error: 2, incomplete: 0 },
  },
  rawMetrics: null,
  logs: "guidellm log line 1\nguidellm log line 2",
  createdAt: "2026-04-26T14:22:00Z",
  startedAt: "2026-04-26T14:22:18Z",
  completedAt: "2026-04-26T14:24:45Z",
};

describe("BenchmarkDetailPage", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("renders completed run with metrics + Duplicate + Delete", async () => {
    vi.mocked(api.get).mockResolvedValue(BASE);
    render(<BenchmarkDetailPage />, { wrapper: Wrapper });
    expect(await screen.findByText("smoke")).toBeInTheDocument();
    expect(screen.getByText(/Completed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /duplicate/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^cancel$/i })).toBeNull();
    expect(screen.getAllByText(/142/).length).toBeGreaterThan(0); // some metric number
  });

  it("renders running run with Cancel only and pending logs message", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...BASE,
      state: "running",
      progress: 0.42,
      metricsSummary: null,
      logs: null,
    });
    render(<BenchmarkDetailPage />, { wrapper: Wrapper });
    expect(await screen.findByText(/Running/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
    expect(screen.getByText(/logs available after run completes/i)).toBeInTheDocument();
  });

  it("renders failed run with red Alert and stateMessage", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...BASE,
      state: "failed",
      stateMessage: "connection refused",
      metricsSummary: null,
      logs: "ERROR: connection refused",
    });
    render(<BenchmarkDetailPage />, { wrapper: Wrapper });
    const matches = await screen.findAllByText(/connection refused/);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("renders 404 EmptyState on ApiError 404", async () => {
    vi.mocked(api.get).mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));
    render(<BenchmarkDetailPage />, { wrapper: Wrapper });
    const matches = await screen.findAllByText(/not found/i);
    expect(matches.length).toBeGreaterThan(0);
  });
});
