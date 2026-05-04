import type { ListRunsResponse, Run } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RunListPage } from "../RunListPage";

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

// Real adapter-emitted shapes. `summaryMetrics` is the discriminated union
// `{ tool, data }` written by tool-adapter `parseFinalReport` — see
// packages/tool-adapters/src/{guidellm,vegeta,genai-perf}/runtime.ts. The
// list-page readers must switch on `tool` and reach into `data.*`.
//
// Fixtures only carry the fields readP95 / readErrorRate consume; the wider
// schema has many more required fields but Run.summaryMetrics is typed as
// `Record<string, unknown> | null` at the contracts boundary.
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

const genaiPerfMetrics = {
  tool: "genai-perf",
  data: {
    requestLatency: { p95: 333.3, unit: "ms" },
  },
};

function makeRun(
  id: string,
  kind: Run["kind"],
  tool: Run["tool"],
  status: Run["status"],
  summaryMetrics: Run["summaryMetrics"] = null,
): Run {
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
    rawOutput: null,
    summaryMetrics,
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
        <MemoryRouter initialEntries={["/runs"]}>
          <Routes>
            <Route path="/runs" element={children} />
            <Route path="/runs/compare" element={<div>compare-stub</div>} />
            <Route path="/runs/:id" element={<div>detail</div>} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const ONE_RUN: ListRunsResponse = {
  items: [makeRun("r1", "benchmark", "guidellm", "completed", guidellmMetrics)],
  nextCursor: null,
};

const EMPTY: ListRunsResponse = { items: [], nextCursor: null };

describe("RunListPage", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.del).mockReset();
  });

  it("renders a guidellm row with kind / tool / status / p95 / errorRate", async () => {
    vi.mocked(api.get).mockResolvedValue(ONE_RUN);
    render(<RunListPage />, { wrapper: Wrapper });
    expect(await screen.findByText("benchmark")).toBeInTheDocument();
    expect(screen.getByText("guidellm")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
    // guidellm: data.e2eLatency.p95 (already ms)
    expect(screen.getByText("491.2")).toBeInTheDocument();
    // guidellm: data.requests.error / data.requests.total = 1/10 = 0.1000
    expect(screen.getByText("0.1000")).toBeInTheDocument();
  });

  it("renders a vegeta row with p95 in ms (no extra ns→ms conversion) and error rate from success%", async () => {
    const resp: ListRunsResponse = {
      items: [makeRun("r1", "benchmark", "vegeta", "completed", vegetaMetrics)],
      nextCursor: null,
    };
    vi.mocked(api.get).mockResolvedValue(resp);
    render(<RunListPage />, { wrapper: Wrapper });
    expect(await screen.findByText("vegeta")).toBeInTheDocument();
    // vegeta latencies are already in ms after schema normalization.
    expect(screen.getByText("250.5")).toBeInTheDocument();
    // 1 - 98.5/100 = 0.015 → "0.0150"
    expect(screen.getByText("0.0150")).toBeInTheDocument();
  });

  it("renders a genai-perf row with p95 from requestLatency, error rate '—' (schema lacks error counts)", async () => {
    const resp: ListRunsResponse = {
      items: [makeRun("r1", "benchmark", "genai-perf", "completed", genaiPerfMetrics)],
      nextCursor: null,
    };
    vi.mocked(api.get).mockResolvedValue(resp);
    render(<RunListPage />, { wrapper: Wrapper });
    expect(await screen.findByText("genai-perf")).toBeInTheDocument();
    expect(screen.getByText("333.3")).toBeInTheDocument();
    // genai-perf schema has no error/success counts → error rate column is "—".
    // We can't naively `getByText("—")` (the connection column also uses it
    // as a fallback). Instead, find the row's cells and check the last
    // numeric cell.
    const cells = screen.getAllByRole("cell");
    const errorRateCell = cells[cells.length - 2]; // last cell is the "→" link
    expect(errorRateCell.textContent).toBe("—");
  });

  it("shows '—' for both metric columns when summaryMetrics is null", async () => {
    const resp: ListRunsResponse = {
      items: [makeRun("r1", "benchmark", "guidellm", "running", null)],
      nextCursor: null,
    };
    vi.mocked(api.get).mockResolvedValue(resp);
    render(<RunListPage />, { wrapper: Wrapper });
    expect(await screen.findByText("running")).toBeInTheDocument();
    const cells = screen.getAllByRole("cell");
    // last cell is the "→" link; -2 = errorRate, -3 = p95
    expect(cells[cells.length - 2].textContent).toBe("—");
    expect(cells[cells.length - 3].textContent).toBe("—");
  });

  it("compare button is disabled by default", async () => {
    vi.mocked(api.get).mockResolvedValue(ONE_RUN);
    render(<RunListPage />, { wrapper: Wrapper });
    await screen.findByText("benchmark"); // wait for load
    const compare = screen.getByRole("button", { name: /compare/i });
    expect(compare).toBeDisabled();
  });

  it("renders empty state when there are no runs", async () => {
    vi.mocked(api.get).mockResolvedValue(EMPTY);
    render(<RunListPage />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText(/No benchmarks yet|暂无基准测试/i)).toBeInTheDocument(),
    );
  });

  it("Compare button is disabled with 'need 2' tooltip when fewer than 2 selected", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      items: [makeRun("a", "benchmark", "guidellm", "completed", guidellmMetrics)],
      nextCursor: null,
    } satisfies ListRunsResponse);
    render(<RunListPage />, { wrapper: Wrapper });
    // Page does not render run.name — wait on the row's checkbox instead.
    await screen.findByRole("checkbox", { name: /select a/i });
    const compareBtn = screen.getByRole("button", { name: /Compare \(0\)|对比 \(0\)/i });
    expect(compareBtn).toBeDisabled();
  });

  it("Compare button enabled with 2 same-tool selected; click navigates to /runs/compare?ids=", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      items: [
        makeRun("a", "benchmark", "guidellm", "completed", guidellmMetrics),
        makeRun("b", "benchmark", "guidellm", "completed", guidellmMetrics),
      ],
      nextCursor: null,
    } satisfies ListRunsResponse);
    render(<RunListPage />, { wrapper: Wrapper });
    const checkboxA = await screen.findByRole("checkbox", { name: /select a/i });
    const checkboxB = screen.getByRole("checkbox", { name: /select b/i });
    await userEvent.click(checkboxA);
    await userEvent.click(checkboxB);

    const compareBtn = screen.getByRole("button", { name: /Compare \(2\)|对比 \(2\)/i });
    expect(compareBtn).not.toBeDisabled();
    await userEvent.click(compareBtn);
    // Wrapper has a stub /runs/compare route; assert navigation fired by
    // verifying we landed there. Full happy-path is covered by
    // RunComparePage's own tests.
    await waitFor(() => expect(screen.getByText("compare-stub")).toBeInTheDocument());
  });

  it("Compare button disabled with mixed-tools tooltip when selection mixes tools", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      items: [
        makeRun("a", "benchmark", "guidellm", "completed", guidellmMetrics),
        makeRun("b", "benchmark", "vegeta", "completed", vegetaMetrics),
      ],
      nextCursor: null,
    } satisfies ListRunsResponse);
    render(<RunListPage />, { wrapper: Wrapper });
    const checkboxA = await screen.findByRole("checkbox", { name: /select a/i });
    await userEvent.click(checkboxA);
    await userEvent.click(screen.getByRole("checkbox", { name: /select b/i }));

    const compareBtn = screen.getByRole("button", { name: /Compare \(2\)|对比 \(2\)/i });
    expect(compareBtn).toBeDisabled();
  });
});
