import type { Run } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HistoryDetailPage } from "../HistoryDetailPage";

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

import { api } from "@/lib/api-client";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "r1",
    userId: "u1",
    connectionId: "c1",
    connection: { id: "c1", name: "vLLM Local" },
    kind: "benchmark",
    tool: "guidellm",
    scenario: { model: "qwen2.5" },
    mode: "fixed",
    driverKind: "local",
    name: "smoke",
    description: null,
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: { profile: "throughput" },
    canonicalReport: null,
    rawOutput: { stdout: "ok" },
    summaryMetrics: { latencies: { p95: 100 }, errorRate: 0.0 },
    serverMetrics: null,
    templateId: null,
    templateVersion: null,
    parentRunId: null,
    baselineId: null,
    baselineFor: null,
    logs: "log line 1\nlog line 2",
    createdAt: "2026-04-30T12:00:00.000Z",
    startedAt: "2026-04-30T12:00:01.000Z",
    completedAt: "2026-04-30T12:00:30.000Z",
    ...overrides,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/history/r1"]}>
          <Routes>
            <Route path="/history" element={<div>list</div>} />
            <Route path="/history/:runId" element={<>{children}</>} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

describe("HistoryDetailPage", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.del).mockReset();
  });

  it("renders metadata, metrics, raw output toggle", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeRun());
    render(<HistoryDetailPage />, { wrapper: Wrapper });
    expect(await screen.findByText("smoke")).toBeInTheDocument();
    expect(screen.getByText("benchmark")).toBeInTheDocument();
    expect(screen.getByText("guidellm")).toBeInTheDocument();
    expect(screen.getByText(/Raw output|原始输出/i)).toBeInTheDocument();
    expect(screen.getByText(/Logs|日志/i)).toBeInTheDocument();
  });

  it("renders metrics empty when summaryMetrics is null", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeRun({ summaryMetrics: null }));
    render(<HistoryDetailPage />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText(/No metrics|没有记录指标/i)).toBeInTheDocument(),
    );
  });

  it("shows not-found state on 404", async () => {
    const err = new Error("not found") as Error & { status: number };
    err.status = 404;
    vi.mocked(api.get).mockRejectedValueOnce(err);
    render(<HistoryDetailPage />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText(/Run not found|Run 不存在/i)).toBeInTheDocument(),
    );
  });
});
