import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return { ApiError, api: { get: vi.fn(), post: vi.fn(), del: vi.fn() } };
});

import { api } from "@/lib/api-client";
import { useBenchmarkDetail } from "../queries";
import type { BenchmarkRun } from "@modeldoctor/contracts";

function makeRun(overrides: Partial<BenchmarkRun> = {}): BenchmarkRun {
  return {
    id: "r1",
    userId: "u1",
    name: "x",
    description: null,
    profile: "throughput",
    apiType: "chat",
    apiUrl: "https://api/v1",
    model: "m",
    datasetName: "random",
    datasetInputTokens: 1024,
    datasetOutputTokens: 128,
    datasetSeed: null,
    requestRate: 0,
    totalRequests: 1000,
    state: "running",
    stateMessage: null,
    jobName: "j",
    progress: 0.5,
    metricsSummary: null,
    rawMetrics: null,
    logs: null,
    createdAt: "2026-04-26T14:22:00Z",
    startedAt: "2026-04-26T14:22:00Z",
    completedAt: null,
    ...overrides,
  };
}

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useBenchmarkDetail polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.get).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls every 2s while non-terminal", async () => {
    vi.mocked(api.get).mockResolvedValue(makeRun({ state: "running" }));
    renderHook(() => useBenchmarkDetail("r1"), { wrapper: makeWrapper() });

    await vi.advanceTimersByTimeAsync(0);
    expect(api.get).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(api.get).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it("stops polling when state becomes terminal", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(makeRun({ state: "running" }))
      .mockResolvedValueOnce(makeRun({ state: "completed" }));

    renderHook(() => useBenchmarkDetail("r1"), { wrapper: makeWrapper() });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);

    expect(api.get).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5000);
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("pauses polling when document is hidden", async () => {
    vi.mocked(api.get).mockResolvedValue(makeRun({ state: "running" }));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });

    renderHook(() => useBenchmarkDetail("r1"), { wrapper: makeWrapper() });

    await vi.advanceTimersByTimeAsync(0);
    expect(api.get).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.get).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });
});
