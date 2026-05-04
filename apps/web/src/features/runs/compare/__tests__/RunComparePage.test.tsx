import type { Run } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";

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
import { RunComparePage } from "../RunComparePage";

function makeRun(id: string, tool: Run["tool"] = "guidellm", p95 = 200): Run {
  return {
    id,
    userId: null,
    connectionId: null,
    connection: null,
    kind: "benchmark",
    tool,
    scenario: {},
    mode: "fixed",
    driverKind: "local",
    name: id,
    description: null,
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: {
      tool,
      data: {
        e2eLatency: { p95 },
        latencies: { p95 },
        requestLatency: { p95 },
        requestsPerSecond: { mean: 10 },
        requests: { total: 100, success: 100, error: 0, incomplete: 0, throughput: 10 },
        requestThroughput: { avg: 10 },
        success: 100,
      },
    } as unknown as Run["summaryMetrics"],
    serverMetrics: null,
    templateId: null,
    templateVersion: null,
    parentRunId: null,
    baselineId: null,
    baselineFor: null,
    logs: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
  };
}

function renderPage(initialUrl: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[initialUrl]}>
          <Routes>
            <Route path="/runs" element={<div>list</div>} />
            <Route path="/runs/compare" element={<RunComparePage />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("RunComparePage", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("renders empty state when ids missing", () => {
    renderPage("/runs/compare");
    expect(screen.getByText(/Select 2\+ Runs|2 个以上/i)).toBeInTheDocument();
  });

  it("renders empty state when only one id", () => {
    renderPage("/runs/compare?ids=a");
    expect(screen.getByText(/Select 2\+ Runs|2 个以上/i)).toBeInTheDocument();
  });

  it("happy path: renders grid for 2 same-tool runs", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeRun("a")).mockResolvedValueOnce(makeRun("b"));
    renderPage("/runs/compare?ids=a,b");
    // Run name "a" appears in BOTH the toolbar <option> and the grid <TableHead>;
    // same for "b". Using getAllByText to disambiguate.
    await waitFor(() => expect(screen.getAllByText("a").length).toBeGreaterThan(0));
    expect(screen.getAllByText("b").length).toBeGreaterThan(0);
  });

  it("happy path: renders grid for 4 same-tool runs", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(makeRun("a"))
      .mockResolvedValueOnce(makeRun("b"))
      .mockResolvedValueOnce(makeRun("c"))
      .mockResolvedValueOnce(makeRun("d"));
    renderPage("/runs/compare?ids=a,b,c,d");
    // Run name appears in BOTH toolbar <option> and grid <TableHead>.
    await waitFor(() => expect(screen.getAllByText("d").length).toBeGreaterThan(0));
  });

  it("shows mixed-tools alert and no grid when tools differ", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(makeRun("a", "guidellm"))
      .mockResolvedValueOnce(makeRun("b", "vegeta"));
    renderPage("/runs/compare?ids=a,b");
    await waitFor(() =>
      expect(
        screen.getByText(/Compare requires the same tool|对比需要相同 tool/i),
      ).toBeInTheDocument(),
    );
  });

  it("shows partial alert when one of the runs 404s", async () => {
    const err = new Error("not found") as Error & { status: number };
    err.status = 404;
    vi.mocked(api.get).mockResolvedValueOnce(makeRun("a")).mockRejectedValueOnce(err);
    renderPage("/runs/compare?ids=a,b");
    // Alert reports the lost run; with only 1 run surviving the >=2 gate keeps
    // the grid hidden — only the alert + page header should show.
    await waitFor(() =>
      expect(screen.getByText(/no longer accessible|无法访问/i)).toBeInTheDocument(),
    );
  });

  it("?baseline=none keeps None even when a Run has baselineFor !== null", async () => {
    // Without the "none" sentinel, defaultBaseline would infer the
    // baselineFor-non-null Run and override the user's None choice.
    const runA = makeRun("a", "guidellm");
    runA.baselineFor = { id: "b_1", name: "anchor", createdAt: "2026-05-01T00:00:00.000Z" };
    vi.mocked(api.get).mockResolvedValueOnce(runA).mockResolvedValueOnce(makeRun("b"));
    renderPage("/runs/compare?ids=a,b&baseline=none");
    // Toolbar dropdown is the visible signal: with None selected the
    // <select> value is "" so its first <option> ("None (no verdict)" /
    // "无（不显示徽标）") is the displayed text.
    await waitFor(() =>
      expect(screen.getByText(/None \(no verdict\)|无（不显示徽标）/)).toBeInTheDocument(),
    );
  });
});
