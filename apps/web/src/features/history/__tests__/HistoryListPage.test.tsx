import type { ListRunsResponse, Run } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HistoryListPage } from "../HistoryListPage";

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

function makeRun(id: string, kind: Run["kind"], tool: Run["tool"], status: Run["status"]): Run {
  return {
    id,
    userId: "u1",
    connectionId: "c1",
    connection: { id: "c1", name: "vLLM Local" },
    kind,
    tool,
    scenario: {},
    mode: "fixed",
    driverKind: "local",
    name: id,
    description: null,
    status,
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    canonicalReport: null,
    rawOutput: null,
    summaryMetrics: { latencies: { p95: 123.4 }, errorRate: 0.001 },
    serverMetrics: null,
    templateId: null,
    templateVersion: null,
    parentRunId: null,
    baselineId: null,
    baselineFor: null,
    logs: null,
    createdAt: "2026-04-30T12:00:00.000Z",
    startedAt: "2026-04-30T12:00:01.000Z",
    completedAt: "2026-04-30T12:00:30.000Z",
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
        <MemoryRouter initialEntries={["/history"]}>
          <Routes>
            <Route path="/history" element={children} />
            <Route path="/history/:runId" element={<div>detail</div>} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const ONE_RUN: ListRunsResponse = {
  items: [makeRun("r1", "benchmark", "guidellm", "completed")],
  nextCursor: null,
};

const EMPTY: ListRunsResponse = { items: [], nextCursor: null };

describe("HistoryListPage", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.del).mockReset();
  });

  it("renders a row with kind / tool / status / p95", async () => {
    vi.mocked(api.get).mockResolvedValue(ONE_RUN);
    render(<HistoryListPage />, { wrapper: Wrapper });
    expect(await screen.findByText("benchmark")).toBeInTheDocument();
    expect(screen.getByText("guidellm")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("123.4")).toBeInTheDocument();
  });

  it("compare button is disabled by default", async () => {
    vi.mocked(api.get).mockResolvedValue(ONE_RUN);
    render(<HistoryListPage />, { wrapper: Wrapper });
    await screen.findByText("benchmark"); // wait for load
    const compare = screen.getByRole("button", { name: /compare/i });
    expect(compare).toBeDisabled();
  });

  it("selecting two rows keeps compare button disabled (placeholder for #46)", async () => {
    const twoRuns: ListRunsResponse = {
      items: [
        makeRun("r1", "benchmark", "guidellm", "completed"),
        makeRun("r2", "benchmark", "vegeta", "completed"),
      ],
      nextCursor: null,
    };
    vi.mocked(api.get).mockResolvedValue(twoRuns);
    const user = userEvent.setup();
    render(<HistoryListPage />, { wrapper: Wrapper });
    await screen.findByText("guidellm");
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);
    const compare = screen.getByRole("button", { name: /compare/i });
    // Disabled by spec: this is the placeholder for #46.
    expect(compare).toBeDisabled();
  });

  it("renders empty state when there are no runs", async () => {
    vi.mocked(api.get).mockResolvedValue(EMPTY);
    render(<HistoryListPage />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText(/No runs yet|暂无 Run/i)).toBeInTheDocument());
  });
});
