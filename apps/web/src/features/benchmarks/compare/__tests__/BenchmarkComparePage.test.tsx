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

/**
 * Wires `api.get(url)` to a per-id Benchmark map: any `/api/benchmarks/{id}`
 * call resolves with the matching benchmark (or rejects with `errors[id]`),
 * and the AI judge provider call always resolves to `null` (disabled). This
 * isolates the test from call-ordering when the page also fires
 * `useLlmJudgeProvider` for the AiAnalysisPanel gating.
 */
function mockApiGet(
  benchmarks: Record<string, Benchmark>,
  errors: Record<string, Error & { status?: number }> = {},
) {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === "/api/llm-judge/providers") return { items: [] } as never;
    const m = url.match(/\/api\/benchmarks\/([^/]+)$/);
    if (m) {
      const id = m[1];
      if (errors[id]) throw errors[id];
      if (benchmarks[id]) return benchmarks[id] as never;
    }
    return null as never;
  });
}

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
    // Default: every test fires `useLlmJudgeProvider` (always-enabled query in
    // the page). Stub it to `null` so non-happy-path tests that don't call
    // `mockApiGet` don't see "Query data cannot be undefined" warnings.
    mockApiGet({});
  });

  it("renders empty state when only one id", () => {
    renderPage("/benchmarks/compare?ids=a");
    expect(screen.getByText(/Select 2\+ benchmarks|2 个以上/i)).toBeInTheDocument();
  });

  it("happy path: renders grid for 2 same-tool benchmarks", async () => {
    mockApiGet({ a: makeBenchmark("a"), b: makeBenchmark("b") });
    renderPage("/benchmarks/compare?ids=a,b");
    // Run name "a" appears in the toolbar <option>, the grid <TableHead>,
    // AND now in the ReportSections test-matrix table — using getAllByText
    // to handle multiple occurrences. Same for "b".
    await waitFor(() => expect(screen.getAllByText("a").length).toBeGreaterThan(0));
    expect(screen.getAllByText("b").length).toBeGreaterThan(0);
  });

  it("happy path: renders grid for 4 same-tool benchmarks", async () => {
    mockApiGet({
      a: makeBenchmark("a"),
      b: makeBenchmark("b"),
      c: makeBenchmark("c"),
      d: makeBenchmark("d"),
    });
    renderPage("/benchmarks/compare?ids=a,b,c,d");
    // Run name appears in toolbar <option>, grid <TableHead>, and the
    // ReportSections test-matrix row.
    await waitFor(() => expect(screen.getAllByText("d").length).toBeGreaterThan(0));
  });

  it("renders one drag handle per run in the test matrix (reorder wired)", async () => {
    // Real pointer DnD is not reproducible in jsdom (zero-sized rects), so
    // assert the sortable wiring instead: the ad-hoc compare page passes
    // onReorder, which renders a grip handle per matrix row. The move math
    // itself is @dnd-kit's arrayMove; URL write-back is a one-liner.
    mockApiGet({ a: makeBenchmark("a"), b: makeBenchmark("b") });
    renderPage("/benchmarks/compare?ids=a,b");
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /Drag to reorder|拖拽调整顺序/ })).toHaveLength(
        2,
      ),
    );
  });

  it("shows mixed-tools alert and no grid when tools differ", async () => {
    mockApiGet({ a: makeBenchmark("a", "guidellm"), b: makeBenchmark("b", "vegeta") });
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
    mockApiGet({
      a: makeBenchmark("a", "guidellm", 200, "inference"),
      b: makeBenchmark("b", "vegeta", 200, "gateway"),
    });
    renderPage("/benchmarks/compare?ids=a,b");
    await waitFor(() =>
      expect(
        screen.getByText(/Compare requires the same scenario|对比需要相同 scenario/i),
      ).toBeInTheDocument(),
    );
    // Grid headers (the run name "a" / "b") would appear ≥1 time inside
    // the table when rendered. Toolbar + ReportSections are also suppressed on
    // mixed scenarios, so neither "a" nor "b" should appear anywhere on the page.
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
    mockApiGet({ a: makeBenchmark("a") }, { b: err });
    renderPage("/benchmarks/compare?ids=a,b");
    // Alert reports the lost benchmark; with only 1 surviving the >=2 gate
    // keeps the grid hidden — only the alert + page header should show.
    await waitFor(() =>
      expect(screen.getByText(/no longer accessible|无法访问/i)).toBeInTheDocument(),
    );
  });

  it("breadcrumb scenario crumb points to /benchmarks/:scenario derived from loaded benchmarks", async () => {
    mockApiGet({
      a: makeBenchmark("a", "guidellm", 200, "inference"),
      b: makeBenchmark("b", "guidellm", 180, "inference"),
    });
    renderPage("/benchmarks/compare?ids=a,b");
    // Wait for the grid to render (both benchmarks loaded)
    await waitFor(() => expect(screen.getAllByText("a").length).toBeGreaterThan(0));
    // Breadcrumb middle crumb is the scenario list link.
    const nav = screen.getByRole("navigation", { name: /breadcrumb/i });
    const link = nav.querySelector("a");
    expect(link).toHaveAttribute("href", "/benchmarks/inference");
  });

  it("?baseline=none keeps None even when a Benchmark has baselineFor !== null", async () => {
    // Without the "none" sentinel, defaultBaseline would infer the
    // baselineFor-non-null Benchmark and override the user's None choice.
    const a = makeBenchmark("a", "guidellm");
    a.baselineFor = { id: "b_1", name: "anchor", createdAt: "2026-05-01T00:00:00.000Z" };
    mockApiGet({ a, b: makeBenchmark("b") });
    renderPage("/benchmarks/compare?ids=a,b&baseline=none");
    // Toolbar dropdown is the visible signal: with None selected the
    // Select trigger shows the first item ("None (no verdict)" /
    // "无（不显示徽标）") as the rendered label.
    await waitFor(() =>
      expect(screen.getByText(/None \(no verdict\)|无（不显示徽标）/)).toBeInTheDocument(),
    );
  });
});
