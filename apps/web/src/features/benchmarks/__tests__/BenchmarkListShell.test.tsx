import type { Benchmark, ListBenchmarksResponse } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BenchmarkListShell } from "../BenchmarkListShell";

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

// The connection filter inside BenchmarkListFilters calls useConnections().
// Stub it so it doesn't consume the list's `api.get` mockResolvedValueOnce
// responses (which would starve the benchmark-list query of its fixtures).
vi.mock("@/features/connections/queries", () => ({
  useConnections: () => ({
    data: [{ id: "c1", name: "vLLM Local", model: "m", baseUrl: "http://x" }],
  }),
}));

// Real adapter-emitted shapes. `summaryMetrics` is the discriminated union
// `{ tool, data }` written by tool-adapter `parseFinalReport` — see
// packages/tool-adapters/src/{guidellm,vegeta,aiperf,evalscope}/runtime.ts.
// The list-page readers must switch on `tool` and reach into `data.*`.
//
// Fixtures only carry the fields readP95 / readErrorRate consume; the wider
// schema has many more required fields but Benchmark.summaryMetrics is typed
// as `Record<string, unknown> | null` at the contracts boundary.
const guidellmMetrics = {
  tool: "guidellm",
  data: {
    e2eLatency: { p95: 491.2 },
    requests: { total: 10, success: 9, error: 1, incomplete: 0 },
  },
};

const vegetaMetrics = {
  tool: "vegeta",
  data: {
    // schema comment notes: vegeta latencies are normalized to ms BEFORE
    // validation; readers must NOT divide by 1e6 again.
    latencies: { p95: 250.5 },
    // success is a percent in [0, 100], not a 0-1 ratio.
    success: 98.5,
    requests: { total: 1000 },
  },
};

function makeBenchmark(
  id: string,
  tool: Benchmark["tool"],
  status: Benchmark["status"],
  summaryMetrics: Benchmark["summaryMetrics"] = null,
): Benchmark {
  return {
    id,
    userId: "u1",
    connectionId: "c1",
    connection: { id: "c1", name: "vLLM Local", model: "m", baseUrl: "http://x" },
    scenario: "inference",
    tool,
    toolVersion: null,
    name: id,
    label: null,
    description: null,
    status,
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics,
    serverMetrics: null,
    templateId: null,
    parentBenchmarkId: null,
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
        <MemoryRouter initialEntries={["/benchmarks"]}>
          <Routes>
            <Route path="/benchmarks" element={children} />
            <Route path="/benchmarks/compare" element={<div>compare-stub</div>} />
            <Route path="/benchmarks/:id" element={<div>detail</div>} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const ONE_BENCHMARK: ListBenchmarksResponse = {
  items: [makeBenchmark("r1", "guidellm", "completed", guidellmMetrics)],
  nextCursor: null,
};

const EMPTY: ListBenchmarksResponse = { items: [], nextCursor: null };

describe("BenchmarkListShell", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.del).mockReset();
  });

  it("renders a guidellm row with tool / status / p95 / errorRate", async () => {
    vi.mocked(api.get).mockResolvedValue(ONE_BENCHMARK);
    render(<BenchmarkListShell scenario="inference" />, { wrapper: Wrapper });
    expect(await screen.findByText("guidellm")).toBeInTheDocument();
    // Status now renders via <StatusBadge> with the i18n label.
    expect(screen.getByText(/Completed|已完成/)).toBeInTheDocument();
    // guidellm: data.e2eLatency.p95 (already ms)
    expect(screen.getByText("491.2")).toBeInTheDocument();
    // guidellm: data.requests.error / data.requests.total = 1/10 = 0.1000
    expect(screen.getByText("0.1000")).toBeInTheDocument();
  });

  it("renders a vegeta row with p95 in ms (no extra ns→ms conversion) and error rate from success%", async () => {
    const resp: ListBenchmarksResponse = {
      items: [makeBenchmark("r1", "vegeta", "completed", vegetaMetrics)],
      nextCursor: null,
    };
    vi.mocked(api.get).mockResolvedValue(resp);
    render(<BenchmarkListShell scenario="inference" />, { wrapper: Wrapper });
    expect(await screen.findByText("vegeta")).toBeInTheDocument();
    // vegeta latencies are already in ms after schema normalization.
    expect(screen.getByText("250.5")).toBeInTheDocument();
    // 1 - 98.5/100 = 0.015 → "0.0150"
    expect(screen.getByText("0.0150")).toBeInTheDocument();
  });

  it("shows '—' for both metric columns when summaryMetrics is null", async () => {
    const resp: ListBenchmarksResponse = {
      items: [makeBenchmark("r1", "guidellm", "running", null)],
      nextCursor: null,
    };
    vi.mocked(api.get).mockResolvedValue(resp);
    render(<BenchmarkListShell scenario="inference" />, { wrapper: Wrapper });
    // <StatusBadge> renders the i18n label for "running".
    expect(await screen.findByText(/Running|运行中/)).toBeInTheDocument();
    const cells = screen.getAllByRole("cell");
    // last cell is the "→" link; -2 = errorRate, -3 = p95
    expect(cells[cells.length - 2].textContent).toBe("—");
    expect(cells[cells.length - 3].textContent).toBe("—");
  });

  it("renders duration with start → end range from startedAt/completedAt", async () => {
    vi.mocked(api.get).mockResolvedValue(ONE_BENCHMARK);
    render(<BenchmarkListShell scenario="inference" />, { wrapper: Wrapper });
    // startedAt 12:00:01Z → completedAt 12:00:30Z = 29s
    expect(await screen.findByText("29s")).toBeInTheDocument();
    // Clock values render in local time — assert the shape, not exact times.
    expect(
      screen.getByText(/\d{2}-\d{2} \d{2}:\d{2}:\d{2} → \d{2}:\d{2}:\d{2}/),
    ).toBeInTheDocument();
  });

  it("renders an all-zero error rate as '0' instead of '0.0000'", async () => {
    const zeroErrorMetrics = {
      tool: "guidellm",
      data: {
        e2eLatency: { p95: 491.2 },
        requests: { total: 10, success: 10, error: 0, incomplete: 0 },
      },
    };
    vi.mocked(api.get).mockResolvedValue({
      items: [makeBenchmark("r1", "guidellm", "completed", zeroErrorMetrics)],
      nextCursor: null,
    } satisfies ListBenchmarksResponse);
    render(<BenchmarkListShell scenario="inference" />, { wrapper: Wrapper });
    await screen.findByText("guidellm");
    const cells = screen.getAllByRole("cell");
    // last cell is actions; -2 = errorRate
    expect(cells[cells.length - 2].textContent).toBe("0");
  });

  it("compare button is disabled by default", async () => {
    vi.mocked(api.get).mockResolvedValue(ONE_BENCHMARK);
    render(<BenchmarkListShell scenario="inference" />, { wrapper: Wrapper });
    await screen.findByText("guidellm"); // wait for load
    const compare = screen.getByRole("button", { name: /compare/i });
    expect(compare).toBeDisabled();
  });

  it("renders empty state when there are no benchmarks", async () => {
    vi.mocked(api.get).mockResolvedValue(EMPTY);
    render(<BenchmarkListShell scenario="inference" />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText(/No benchmarks yet|暂无基准测试/i)).toBeInTheDocument(),
    );
  });

  it("Compare button is disabled with 'need 2' tooltip when fewer than 2 selected", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      items: [makeBenchmark("a", "guidellm", "completed", guidellmMetrics)],
      nextCursor: null,
    } satisfies ListBenchmarksResponse);
    render(<BenchmarkListShell scenario="inference" />, { wrapper: Wrapper });
    // Page does not render run.name — wait on the row's checkbox instead.
    await screen.findByRole("checkbox", { name: /select a/i });
    const compareBtn = screen.getByRole("button", { name: /Compare \(0\)|对比 \(0\)/i });
    expect(compareBtn).toBeDisabled();
  });

  it("Compare button enabled with 2 same-tool selected; click navigates to /benchmarks/compare?ids=", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      items: [
        makeBenchmark("a", "guidellm", "completed", guidellmMetrics),
        makeBenchmark("b", "guidellm", "completed", guidellmMetrics),
      ],
      nextCursor: null,
    } satisfies ListBenchmarksResponse);
    render(<BenchmarkListShell scenario="inference" />, { wrapper: Wrapper });
    const checkboxA = await screen.findByRole("checkbox", { name: /select a/i });
    const checkboxB = screen.getByRole("checkbox", { name: /select b/i });
    await userEvent.click(checkboxA);
    await userEvent.click(checkboxB);

    const compareBtn = screen.getByRole("button", { name: /Compare \(2\)|对比 \(2\)/i });
    expect(compareBtn).not.toBeDisabled();
    await userEvent.click(compareBtn);
    // Wrapper has a stub /benchmarks/compare route; assert navigation fired by
    // verifying we landed there. Full happy-path is covered by
    // BenchmarkComparePage's own tests.
    await waitFor(() => expect(screen.getByText("compare-stub")).toBeInTheDocument());
  });

  it("bulk-deletes selected rows via POST /bulk-delete after confirm", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [
        makeBenchmark("a", "guidellm", "completed", guidellmMetrics),
        makeBenchmark("b", "guidellm", "completed", guidellmMetrics),
      ],
      nextCursor: null,
    } satisfies ListBenchmarksResponse);
    vi.mocked(api.post).mockResolvedValue({ deleted: 2 });
    render(<BenchmarkListShell scenario="inference" />, { wrapper: Wrapper });

    await userEvent.click(await screen.findByRole("checkbox", { name: /select a/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /select b/i }));

    // Bulk-delete button appears once a row is selected.
    await userEvent.click(screen.getByRole("button", { name: /Delete \(2\)|删除 \(2\)/i }));

    // ConfirmDeleteDialog is type-to-confirm: the destructive button stays
    // disabled until "DELETE" is typed into the keyword input.
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.type(within(dialog).getByRole("textbox"), "DELETE");
    const confirmBtn = within(dialog).getByRole("button", { name: /^Delete$|^确认删除$/ });
    expect(confirmBtn).not.toBeDisabled();
    await userEvent.click(confirmBtn);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/benchmarks/bulk-delete", {
        ids: ["a", "b"],
      }),
    );
  });

  it("clears the selection when a filter changes (no stale bulk delete of hidden rows)", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [makeBenchmark("a", "guidellm", "completed", guidellmMetrics)],
      nextCursor: null,
    } satisfies ListBenchmarksResponse);
    render(<BenchmarkListShell scenario="inference" />, { wrapper: Wrapper });

    await userEvent.click(await screen.findByRole("checkbox", { name: /select a/i }));
    expect(screen.getByRole("button", { name: /Delete \(1\)|删除 \(1\)/i })).toBeInTheDocument();

    // Change the Status filter → URL params change → selection must reset.
    await userEvent.click(screen.getByRole("combobox", { name: /Status|状态/ }));
    await userEvent.click(screen.getByRole("option", { name: /Completed|已完成/ }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Delete \(\d+\)|删除 \(\d+\)/i })).toBeNull(),
    );
  });

  it("renders the benchmark name in the first content column", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      items: [makeBenchmark("r1", "guidellm", "completed", guidellmMetrics)],
      nextCursor: null,
    } satisfies ListBenchmarksResponse);
    render(<BenchmarkListShell scenario="inference" />, { wrapper: Wrapper });
    // benchmark.name is set to the id in makeBenchmark; expect to find "r1"
    expect(await screen.findByText("r1")).toBeInTheDocument();
  });

  it("Compare button disabled with mixed-tools tooltip when selection mixes tools", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      items: [
        makeBenchmark("a", "guidellm", "completed", guidellmMetrics),
        makeBenchmark("b", "vegeta", "completed", vegetaMetrics),
      ],
      nextCursor: null,
    } satisfies ListBenchmarksResponse);
    render(<BenchmarkListShell scenario="inference" />, { wrapper: Wrapper });
    const checkboxA = await screen.findByRole("checkbox", { name: /select a/i });
    await userEvent.click(checkboxA);
    await userEvent.click(screen.getByRole("checkbox", { name: /select b/i }));

    const compareBtn = screen.getByRole("button", { name: /Compare \(2\)|对比 \(2\)/i });
    expect(compareBtn).toBeDisabled();
  });

  it("save-as-template menu item is disabled for non-completed rows", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [makeBenchmark("r1", "guidellm", "running", null)],
      nextCursor: null,
    } satisfies ListBenchmarksResponse);
    render(<BenchmarkListShell scenario="inference" />, { wrapper: Wrapper });
    await screen.findByText("r1");
    await userEvent.click(screen.getByRole("button", { name: /more|更多/i }));
    const menuItem = await screen.findByRole("menuitem", { name: /save as template|保存为模板/i });
    expect(menuItem).toHaveAttribute("aria-disabled", "true");
  });

  it("save-as-template menu item opens dialog for completed rows", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [makeBenchmark("r1", "guidellm", "completed", guidellmMetrics)],
      nextCursor: null,
    } satisfies ListBenchmarksResponse);
    render(<BenchmarkListShell scenario="inference" />, { wrapper: Wrapper });
    await screen.findByText("r1");
    await userEvent.click(screen.getByRole("button", { name: /more|更多/i }));
    const menuItem = await screen.findByRole("menuitem", { name: /save as template|保存为模板/i });
    await userEvent.click(menuItem);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
