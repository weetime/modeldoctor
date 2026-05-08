import type { Benchmark } from "@modeldoctor/contracts";
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
import { BenchmarkComparePage } from "../BenchmarkComparePage";

function makeBenchmark(
  id: string,
  tool: Benchmark["tool"] = "guidellm",
  p95 = 200,
  scenario: Benchmark["scenario"] = "inference",
): Benchmark {
  return {
    id,
    userId: null,
    connectionId: null,
    connection: null,
    scenario,
    tool,
    toolVersion: null,
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
    } as unknown as Benchmark["summaryMetrics"],
    serverMetrics: null,
    templateId: null,
    parentBenchmarkId: null,
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
            <Route path="/benchmarks" element={<div>list</div>} />
            <Route path="/benchmarks/compare" element={<BenchmarkComparePage />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("BenchmarkComparePage", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("renders empty state when only one id", () => {
    renderPage("/benchmarks/compare?ids=a");
    expect(screen.getByText(/Select 2\+ benchmarks|2 个以上/i)).toBeInTheDocument();
  });

  it("happy path: renders grid for 2 same-tool benchmarks", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(makeBenchmark("a"))
      .mockResolvedValueOnce(makeBenchmark("b"));
    renderPage("/benchmarks/compare?ids=a,b");
    // Run name "a" appears in BOTH the toolbar <option> and the grid <TableHead>;
    // same for "b". Using getAllByText to disambiguate.
    await waitFor(() => expect(screen.getAllByText("a").length).toBeGreaterThan(0));
    expect(screen.getAllByText("b").length).toBeGreaterThan(0);
  });

  it("happy path: renders grid for 4 same-tool benchmarks", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(makeBenchmark("a"))
      .mockResolvedValueOnce(makeBenchmark("b"))
      .mockResolvedValueOnce(makeBenchmark("c"))
      .mockResolvedValueOnce(makeBenchmark("d"));
    renderPage("/benchmarks/compare?ids=a,b,c,d");
    // Run name appears in BOTH toolbar <option> and grid <TableHead>.
    await waitFor(() => expect(screen.getAllByText("d").length).toBeGreaterThan(0));
  });

  it("shows mixed-tools alert and no grid when tools differ", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(makeBenchmark("a", "guidellm"))
      .mockResolvedValueOnce(makeBenchmark("b", "vegeta"));
    renderPage("/benchmarks/compare?ids=a,b");
    await waitFor(() =>
      expect(
        screen.getByText(/Compare requires the same tool|对比需要相同 tool/i),
      ).toBeInTheDocument(),
    );
  });

  it("shows mixed-scenarios alert and no grid when scenarios differ", async () => {
    // inference + gateway is the canonical cross-scenario case (each uses a
    // different tool, but the scenario gate fires first regardless).
    vi.mocked(api.get)
      .mockResolvedValueOnce(makeBenchmark("a", "guidellm", 200, "inference"))
      .mockResolvedValueOnce(makeBenchmark("b", "vegeta", 200, "gateway"));
    renderPage("/benchmarks/compare?ids=a,b");
    await waitFor(() =>
      expect(
        screen.getByText(/Compare requires the same scenario|对比需要相同 scenario/i),
      ).toBeInTheDocument(),
    );
    // Grid headers (the run name "a" / "b") would appear ≥1 time inside
    // the table when rendered. Toolbar is also suppressed on mixed scenarios,
    // so neither "a" nor "b" should appear anywhere on the page.
    expect(screen.queryByText("a")).not.toBeInTheDocument();
    expect(screen.queryByText("b")).not.toBeInTheDocument();
  });

  it("renders nothing when mounted directly with no ids (gate-bypass safety)", () => {
    // BenchmarkCompareGate normally intercepts no-ids navigation and
    // redirects to /benchmarks/inference. If something bypasses the gate
    // and mounts the page directly, it should render null rather than the
    // old picker (which was removed).
    const { container } = renderPage("/benchmarks/compare");
    // No Compare header, no benchmark grid — empty container.
    expect(container.querySelector("h1")).toBeNull();
  });

  it("shows partial alert when one of the benchmarks 404s", async () => {
    const err = new Error("not found") as Error & { status: number };
    err.status = 404;
    vi.mocked(api.get).mockResolvedValueOnce(makeBenchmark("a")).mockRejectedValueOnce(err);
    renderPage("/benchmarks/compare?ids=a,b");
    // Alert reports the lost benchmark; with only 1 surviving the >=2 gate
    // keeps the grid hidden — only the alert + page header should show.
    await waitFor(() =>
      expect(screen.getByText(/no longer accessible|无法访问/i)).toBeInTheDocument(),
    );
  });

  it("back link points to /benchmarks/:scenario derived from loaded benchmarks", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(makeBenchmark("a", "guidellm", 200, "inference"))
      .mockResolvedValueOnce(makeBenchmark("b", "guidellm", 180, "inference"));
    renderPage("/benchmarks/compare?ids=a,b");
    // Wait for the grid to render (both benchmarks loaded)
    await waitFor(() => expect(screen.getAllByText("a").length).toBeGreaterThan(0));
    const backLink = screen.getByRole("link", { name: /Back to list|返回列表/ });
    expect(backLink).toHaveAttribute("href", "/benchmarks/inference");
  });

  it("?baseline=none keeps None even when a Benchmark has baselineFor !== null", async () => {
    // Without the "none" sentinel, defaultBaseline would infer the
    // baselineFor-non-null Benchmark and override the user's None choice.
    const a = makeBenchmark("a", "guidellm");
    a.baselineFor = { id: "b_1", name: "anchor", createdAt: "2026-05-01T00:00:00.000Z" };
    vi.mocked(api.get).mockResolvedValueOnce(a).mockResolvedValueOnce(makeBenchmark("b"));
    renderPage("/benchmarks/compare?ids=a,b&baseline=none");
    // Toolbar dropdown is the visible signal: with None selected the
    // Select trigger shows the first item ("None (no verdict)" /
    // "无（不显示徽标）") as the rendered label.
    await waitFor(() =>
      expect(screen.getByText(/None \(no verdict\)|无（不显示徽标）/)).toBeInTheDocument(),
    );
  });
});
