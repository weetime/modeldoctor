import type { ListBenchmarksResponse } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { BenchmarkListPage } from "../BenchmarkListPage";

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

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/benchmarks"]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const EMPTY: ListBenchmarksResponse = { items: [], nextCursor: null };

const ONE_COMPLETED: ListBenchmarksResponse = {
  items: [
    {
      id: "r1",
      userId: "u1",
      connectionId: "c1",
      name: "vllm-llama3-tput",
      profile: "throughput",
      apiType: "chat",
      apiBaseUrl: "https://api.example.com",
      model: "llama-3-8b",
      datasetName: "random",
      state: "completed",
      progress: 1,
      metricsSummary: {
        ttft: { mean: 142, p50: 137, p95: 198, p99: 240 },
        itl: { mean: 14.2, p50: 13.8, p95: 18.4, p99: 22.1 },
        e2eLatency: { mean: 1200, p50: 1180, p95: 1500, p99: 1800 },
        requestsPerSecond: { mean: 8.4 },
        outputTokensPerSecond: { mean: 142.3 },
        inputTokensPerSecond: { mean: 1024 },
        totalTokensPerSecond: { mean: 1166.3 },
        concurrency: { mean: 12.1, max: 32 },
        requests: { total: 1000, success: 998, error: 2, incomplete: 0 },
      },
      createdAt: "2026-04-26T14:22:00Z",
      startedAt: "2026-04-26T14:22:18Z",
      completedAt: "2026-04-26T14:24:45Z",
    },
  ],
  nextCursor: null,
};

describe("BenchmarkListPage", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.del).mockReset();
  });

  it("renders empty state when there are no runs", async () => {
    vi.mocked(api.get).mockResolvedValue(EMPTY);
    render(<BenchmarkListPage />, { wrapper: Wrapper });
    expect(await screen.findByText(/no benchmarks yet/i)).toBeInTheDocument();
  });

  it("renders the 8 columns + a row when data arrives", async () => {
    vi.mocked(api.get).mockResolvedValue(ONE_COMPLETED);
    render(<BenchmarkListPage />, { wrapper: Wrapper });
    expect(await screen.findByText("vllm-llama3-tput")).toBeInTheDocument();
    expect(screen.getByText("llama-3-8b")).toBeInTheDocument();
    expect(screen.getByText("Throughput")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("142.3")).toBeInTheDocument(); // outputTps
    expect(screen.getByText(/142(\.0)?\s*ms/i)).toBeInTheDocument(); // ttft mean
  });

  it("shows filtered-empty message when filters yield no rows", async () => {
    vi.mocked(api.get).mockResolvedValue(EMPTY);
    render(<BenchmarkListPage />, { wrapper: Wrapper });
    const stateFilter = await screen.findByLabelText(/state/i);
    await userEvent.click(stateFilter);
    await userEvent.click(screen.getByRole("option", { name: /running/i }));
    await waitFor(() =>
      expect(screen.getByText(/no benchmarks match these filters/i)).toBeInTheDocument(),
    );
  });

  it("renders inline alert on query error", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("server down"));
    render(<BenchmarkListPage />, { wrapper: Wrapper });
    expect(await screen.findByText(/server down/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
