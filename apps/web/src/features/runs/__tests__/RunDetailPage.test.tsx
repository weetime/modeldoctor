import type { Run } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RunDetailPage } from "../RunDetailPage";

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

// ECharts uses canvas APIs not present in jsdom; stub the chart components
// so the new RunChartsSection can render in this page test.
vi.mock("@/components/charts", () => ({
  LatencyCDF: (props: { ariaLabel?: string; series: unknown[] }) => (
    <div
      data-testid="latency-cdf"
      data-aria={props.ariaLabel}
      data-series-count={props.series.length}
    />
  ),
  TTFTHistogram: (props: { ariaLabel?: string; series: unknown[] }) => (
    <div
      data-testid="ttft-histogram"
      data-aria={props.ariaLabel}
      data-series-count={props.series.length}
    />
  ),
  assignRunColors: () => ({}),
}));

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
        <MemoryRouter initialEntries={["/runs/r1"]}>
          <Routes>
            <Route path="/runs" element={<div>list</div>} />
            <Route path="/runs/:id" element={children} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.del).mockReset();
  });

  it("renders metadata, metrics, raw output toggle", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeRun());
    render(<RunDetailPage />, { wrapper: Wrapper });
    expect(await screen.findByText("smoke")).toBeInTheDocument();
    expect(screen.getByText("benchmark")).toBeInTheDocument();
    expect(screen.getByText("guidellm")).toBeInTheDocument();
    expect(screen.getByText(/Raw output|原始输出/i)).toBeInTheDocument();
    expect(screen.getByText(/Logs|日志/i)).toBeInTheDocument();
  });

  it("renders metrics empty when summaryMetrics is null", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeRun({ summaryMetrics: null }));
    render(<RunDetailPage />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText(/No metrics|没有记录指标/i)).toBeInTheDocument());
  });

  it("shows not-found state on 404", async () => {
    const err = new Error("not found") as Error & { status: number };
    err.status = 404;
    vi.mocked(api.get).mockRejectedValueOnce(err);
    render(<RunDetailPage />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText(/Not found|记录不存在/i)).toBeInTheDocument());
  });

  it("renders 'Set as baseline' when run.baselineFor is null", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeRun({ baselineFor: null }));
    render(<RunDetailPage />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Set as baseline|设为基线/ })).toBeInTheDocument(),
    );
  });

  it("renders 'Unset' when run.baselineFor is populated", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeRun({
        baselineFor: { id: "b_1", name: "anchor", createdAt: "2026-05-02T00:00:00.000Z" },
      }),
    );
    render(<RunDetailPage />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Baseline · Unset|已是基线/ })).toBeInTheDocument(),
    );
  });

  it("renders GuidellmReportView when summaryMetrics.tool === 'guidellm'", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeRun({
        summaryMetrics: {
          tool: "guidellm",
          data: {
            ttft: { mean: 12, p50: 11, p90: 14, p95: 18, p99: 25 },
            itl: { mean: 5, p50: 5, p90: 6, p95: 7, p99: 8 },
            e2eLatency: { mean: 100, p50: 95, p90: 130, p95: 150, p99: 200 },
            requestsPerSecond: { mean: 42 },
            outputTokensPerSecond: { mean: 1500 },
            inputTokensPerSecond: { mean: 800 },
            totalTokensPerSecond: { mean: 2300 },
            concurrency: { mean: 16, max: 24 },
            requests: { total: 1000, success: 985, error: 10, incomplete: 5 },
          },
        },
      }),
    );
    render(<RunDetailPage />, { wrapper: Wrapper });
    await screen.findByText(/TTFT/i);
  });

  it("renders VegetaReportView when summaryMetrics.tool === 'vegeta'", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeRun({
        summaryMetrics: {
          tool: "vegeta",
          data: {
            requests: { total: 600, rate: 10, throughput: 9.8 },
            duration: { totalSeconds: 60, attackSeconds: 60, waitSeconds: 0 },
            latencies: { min: 5, mean: 25, p50: 22, p90: 38, p95: 45, p99: 80, max: 120 },
            bytesIn: { total: 1000, mean: 16 },
            bytesOut: { total: 500, mean: 8 },
            success: 99.5,
            statusCodes: { "200": 597, "500": 3 },
            errors: [],
          },
        },
      }),
    );
    render(<RunDetailPage />, { wrapper: Wrapper });
    await screen.findByText(/Status codes/i);
  });

  it("renders GenaiPerfReportView when summaryMetrics.tool === 'genai-perf'", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeRun({
        summaryMetrics: {
          tool: "genai-perf",
          data: {
            requestThroughput: { avg: 50, unit: "req/s" },
            requestLatency: {
              avg: 12,
              min: 10,
              max: 30,
              p50: 12,
              p90: 18,
              p95: 22,
              p99: 28,
              stddev: 4,
              unit: "ms",
            },
            timeToFirstToken: {
              avg: 12,
              min: 10,
              max: 30,
              p50: 12,
              p90: 18,
              p95: 22,
              p99: 28,
              stddev: 4,
              unit: "ms",
            },
            interTokenLatency: {
              avg: 5,
              min: 3,
              max: 10,
              p50: 5,
              p90: 7,
              p95: 8,
              p99: 9,
              stddev: 1,
              unit: "ms",
            },
            outputTokenThroughput: { avg: 1200, unit: "tok/s" },
            outputSequenceLength: { avg: 256, p50: 250, p99: 400 },
            inputSequenceLength: { avg: 128, p50: 120, p99: 200 },
          },
        },
      }),
    );
    render(<RunDetailPage />, { wrapper: Wrapper });
    await screen.findByText(/Sequence length/i);
  });

  it("renders statusMessage Alert when status=failed and statusMessage is set", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeRun({
        status: "failed",
        statusMessage: "SubprocessDriver: failed to spawn wrapper (no pid)",
      }),
    );
    render(<RunDetailPage />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText(/Failure reason|失败原因/i)).toBeInTheDocument());
    expect(screen.getByText(/SubprocessDriver: failed to spawn wrapper/)).toBeInTheDocument();
  });

  it("does not render statusMessage Alert when status=failed but statusMessage is null", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeRun({ status: "failed", statusMessage: null }));
    render(<RunDetailPage />, { wrapper: Wrapper });
    await screen.findByText("smoke");
    expect(screen.queryByText(/Failure reason|失败原因/i)).not.toBeInTheDocument();
  });

  it("does not render statusMessage Alert when status is not failed (even if statusMessage set)", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeRun({ status: "completed", statusMessage: "stale message from earlier attempt" }),
    );
    render(<RunDetailPage />, { wrapper: Wrapper });
    await screen.findByText("smoke");
    expect(screen.queryByText(/Failure reason|失败原因/i)).not.toBeInTheDocument();
  });

  it("renders UnknownReportView for unrecognized envelope", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeRun({
        summaryMetrics: { tool: "future-tool", data: { something: "else" } },
      }),
    );
    render(<RunDetailPage />, { wrapper: Wrapper });
    await screen.findByText(/Report shape not recognized/i);
  });

  it("shows the delete button when the run is terminal", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeRun({ status: "completed" }));
    render(<RunDetailPage />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Delete$|^删除$/ })).toBeInTheDocument(),
    );
  });

  it("hides the delete button while the run is still running", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeRun({ status: "running" }));
    render(<RunDetailPage />, { wrapper: Wrapper });
    await screen.findByText("smoke");
    expect(screen.queryByRole("button", { name: /^Delete$|^删除$/ })).not.toBeInTheDocument();
  });

  it("calls DELETE and navigates back to list after confirm", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeRun({ status: "completed" }));
    vi.mocked(api.del).mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<RunDetailPage />, { wrapper: Wrapper });
    const deleteBtn = await screen.findByRole("button", { name: /^Delete$|^删除$/ });
    await user.click(deleteBtn);
    const confirm = await screen.findByRole("button", { name: /^Delete$|^确认删除$/ });
    await user.click(confirm);
    await waitFor(() => expect(api.del).toHaveBeenCalledWith("/api/runs/r1"));
    await waitFor(() => expect(screen.getByText("list")).toBeInTheDocument());
  });

  it("shows the running placeholder while status=running and hides metrics", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeRun({
        status: "running",
        summaryMetrics: null,
        rawOutput: null,
      }),
    );
    render(<RunDetailPage />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText(/Running…|运行中…/)).toBeInTheDocument());
    expect(screen.queryByText(/Raw output|原始输出/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Summary metrics|汇总指标/i)).not.toBeInTheDocument();
  });

  it("shows the pending label while status=submitted", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeRun({ status: "submitted", startedAt: null, summaryMetrics: null, rawOutput: null }),
    );
    render(<RunDetailPage />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText(/Waiting to start…|等待启动…/)).toBeInTheDocument(),
    );
  });

  it("hides Set-as-baseline / Delete buttons while non-terminal", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeRun({ status: "running", summaryMetrics: null, rawOutput: null }),
    );
    render(<RunDetailPage />, { wrapper: Wrapper });
    await screen.findByText(/Running…|运行中…/);
    expect(
      screen.queryByRole("button", { name: /Set as baseline|设为基线/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete$|^删除$/ })).not.toBeInTheDocument();
  });

  // ---- F4: Re-run button (one-click clone-and-submit, see #88) ----

  it("renders the Re-run button when terminal", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeRun({ status: "completed" }));
    render(<RunDetailPage />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Re-run$|^重跑$/ })).toBeInTheDocument(),
    );
  });

  it("hides the Re-run button while non-terminal", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeRun({ status: "running", summaryMetrics: null, rawOutput: null }),
    );
    render(<RunDetailPage />, { wrapper: Wrapper });
    await screen.findByText(/Running…|运行中…/);
    expect(screen.queryByRole("button", { name: /^Re-run$|^重跑$/ })).not.toBeInTheDocument();
  });

  it("disables the Re-run button when the source connection has been deleted", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeRun({ status: "completed", connectionId: null, connection: null }),
    );
    render(<RunDetailPage />, { wrapper: Wrapper });
    const btn = await screen.findByRole("button", { name: /^Re-run$|^重跑$/ });
    expect(btn).toBeDisabled();
  });

  it("clones tool / connectionId / kind / params on click and POSTs to /api/runs", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeRun({
        status: "completed",
        tool: "guidellm",
        kind: "benchmark",
        connectionId: "c1",
        params: { profile: "throughput", totalRequests: 500 },
        name: "smoke",
      }),
    );
    vi.mocked(api.post).mockResolvedValueOnce(makeRun({ id: "r2", name: "smoke (rerun)" }));
    const user = userEvent.setup();
    render(<RunDetailPage />, { wrapper: Wrapper });
    const btn = await screen.findByRole("button", { name: /^Re-run$|^重跑$/ });
    await user.click(btn);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [path, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("/api/runs");
    expect(body.tool).toBe("guidellm");
    expect(body.kind).toBe("benchmark");
    expect(body.connectionId).toBe("c1");
    expect(body.params).toEqual({ profile: "throughput", totalRequests: 500 });
    // Name suffix: original name + " (rerun)"
    expect(body.name).toBe("smoke (rerun)");
  });

  it("falls back to a synthetic name when the source Run has no name", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeRun({ status: "completed", name: null }));
    vi.mocked(api.post).mockResolvedValueOnce(makeRun({ id: "r2" }));
    const user = userEvent.setup();
    render(<RunDetailPage />, { wrapper: Wrapper });
    const btn = await screen.findByRole("button", { name: /^Re-run$|^重跑$/ });
    await user.click(btn);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, unknown>];
    // Schema requires name to be 1..128; synthesized payload must satisfy that.
    expect(typeof body.name).toBe("string");
    expect((body.name as string).length).toBeGreaterThan(0);
    expect((body.name as string).length).toBeLessThanOrEqual(128);
  });

  it("truncates the source name so the ' (rerun)' suffix fits within the 128-char limit", async () => {
    const longName = "x".repeat(125); // 125 + " (rerun)" (8) = 133 > 128
    vi.mocked(api.get).mockResolvedValueOnce(makeRun({ status: "completed", name: longName }));
    vi.mocked(api.post).mockResolvedValueOnce(makeRun({ id: "r2" }));
    const user = userEvent.setup();
    render(<RunDetailPage />, { wrapper: Wrapper });
    const btn = await screen.findByRole("button", { name: /^Re-run$|^重跑$/ });
    await user.click(btn);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, unknown>];
    expect((body.name as string).length).toBeLessThanOrEqual(128);
    expect((body.name as string).endsWith(" (rerun)")).toBe(true);
  });

  it("navigates to the new Run detail page on success", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeRun({ status: "completed" }));
    // Second api.get is for the new Run detail page after navigation.
    vi.mocked(api.get).mockResolvedValueOnce(makeRun({ id: "r2", name: "smoke (rerun)" }));
    vi.mocked(api.post).mockResolvedValueOnce(makeRun({ id: "r2", name: "smoke (rerun)" }));
    const user = userEvent.setup();
    render(<RunDetailPage />, { wrapper: Wrapper });
    const btn = await screen.findByRole("button", { name: /^Re-run$|^重跑$/ });
    await user.click(btn);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/api/runs/r2"));
  });

  it("polls every 2s while non-terminal and stops on terminal", async () => {
    vi.useFakeTimers();
    try {
      const get = vi.mocked(api.get);
      get
        .mockResolvedValueOnce(
          makeRun({ status: "running", summaryMetrics: null, rawOutput: null }),
        )
        .mockResolvedValueOnce(
          makeRun({ status: "running", summaryMetrics: null, rawOutput: null }),
        )
        .mockResolvedValueOnce(makeRun({ status: "completed" }))
        // Once the run flips to terminal, RunChartsSection mounts and fires a
        // single GET /api/runs/:id/charts request.
        .mockResolvedValueOnce({ latencyCdf: null, ttftHistogram: null });
      render(<RunDetailPage />, { wrapper: Wrapper });
      // Initial fetch
      await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
      // Advance 2s — should fetch again (still running)
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
      // Advance 2s more — third fetch returns terminal, then RunChartsSection
      // fires a fourth call (the /charts endpoint).
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(4));
      // After terminal, advancing 4s must NOT trigger another run-detail poll
      // (the /charts response is cached by react-query).
      await vi.advanceTimersByTimeAsync(4_000);
      expect(get).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("mounts RunChartsSection when status is terminal", async () => {
    // First call: GET /api/runs/:id (run detail). Second: GET /api/runs/:id/charts.
    vi.mocked(api.get)
      .mockResolvedValueOnce(makeRun({ status: "completed" }))
      .mockResolvedValueOnce({
        latencyCdf: { samples: [10, 20] },
        ttftHistogram: { buckets: [{ lower: 0, upper: 10, count: 2 }] },
      });
    render(<RunDetailPage />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText(/Distributions|分布图/i)).toBeInTheDocument());
  });

  it("does NOT mount RunChartsSection when status is non-terminal", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeRun({ status: "running" }));
    render(<RunDetailPage />, { wrapper: Wrapper });
    await screen.findByText(/Running…|运行中…/i);
    expect(screen.queryByText(/Distributions|分布图/i)).not.toBeInTheDocument();
  });
});
