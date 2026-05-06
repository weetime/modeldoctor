import i18n from "@/lib/i18n";
import type { Benchmark, ConnectionPublic, ListBenchmarksResponse } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestInsightsDetailPage } from "../TestInsightsDetailPage";

vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
import { api } from "@/lib/api-client";

beforeEach(() => {
  vi.mocked(api.get).mockReset();
});

// echarts wrapper is verified in its own spec; stub here to keep the
// page test fast.
vi.mock("../TestInsightsP95Chart", () => ({
  TestInsightsP95Chart: ({ points }: { points: unknown[] }) => (
    <div data-testid="p95-chart" data-len={points.length} />
  ),
}));

const conn: ConnectionPublic = {
  id: "c_1",
  userId: "u_1",
  name: "bge-by-mis-tei",
  baseUrl: "http://x",
  apiKeyPreview: "sk-...",
  model: "m1",
  customHeaders: "",
  queryParams: "",
  category: "embeddings",
  tags: [],
  prometheusUrl: null,
  serverKind: null,
  tokenizerHfId: null,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z",
};

function makeRun(over: Partial<Benchmark> = {}): Benchmark {
  return {
    id: over.id ?? "b_1",
    userId: "u_1",
    connectionId: "c_1",
    connection: { id: "c_1", name: "bge-by-mis-tei", model: "m1", baseUrl: "http://x" },
    scenario: "inference",
    tool: "guidellm",
    toolVersion: null,
    name: over.name ?? "run",
    description: null,
    status: over.status ?? "completed",
    statusMessage: null,
    progress: 1,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: over.summaryMetrics ?? {
      tool: "guidellm",
      data: { e2eLatency: { p95: 100 }, requests: { total: 100, error: 0 } },
    },
    serverMetrics: null,
    templateId: null,
    parentBenchmarkId: null,
    baselineId: null,
    logs: null,
    createdAt: over.createdAt ?? "2026-05-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    baselineFor: null,
    ...over,
  };
}

function withProviders(initialUrl = "/benchmarks/reports/c_1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (children: React.ReactNode) => (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[initialUrl]}>
          <Routes>
            <Route path="/benchmarks/reports/:connectionId" element={children} />
            <Route path="/benchmarks/reports" element={<div>insights index</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

describe("TestInsightsDetailPage", () => {
  it("renders notFound state when /api/connections/:id 404s", async () => {
    const err = new Error("not found") as Error & { status: number };
    err.status = 404;
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith("/api/connections/")) return Promise.reject(err) as never;
      return Promise.resolve({ items: [], nextCursor: null }) as never;
    });
    const wrap = withProviders();
    render(wrap(<TestInsightsDetailPage />));
    await waitFor(() =>
      expect(screen.getByText(/Connection not found|未找到此连接/i)).toBeInTheDocument(),
    );
  });

  it("renders header + empty body when connection has no runs in window", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith("/api/connections/")) return Promise.resolve(conn) as never;
      return Promise.resolve({
        items: [],
        nextCursor: null,
      } satisfies ListBenchmarksResponse) as never;
    });
    const wrap = withProviders();
    render(wrap(<TestInsightsDetailPage />));
    await waitFor(() => expect(screen.getByText("bge-by-mis-tei")).toBeInTheDocument());
    expect(
      screen.getByText(/No benchmarks within|选定时间范围内没有基准测试/i),
    ).toBeInTheDocument();
  });

  it("renders summary tile + chart + table when runs exist", async () => {
    const runs: ListBenchmarksResponse = {
      items: [
        makeRun({ id: "b1", name: "alpha" }),
        makeRun({ id: "b2", name: "beta", tool: "vegeta" }),
      ],
      nextCursor: null,
    };
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith("/api/connections/")) return Promise.resolve(conn) as never;
      return Promise.resolve(runs) as never;
    });
    const wrap = withProviders();
    render(wrap(<TestInsightsDetailPage />));

    // Connection settles first (single-fetch useQuery), runs settles second
    // (useInfiniteQuery — slower on CI). Wait on the runs-dependent state
    // explicitly so we don't race the second resolution.
    expect(
      await screen.findByText("bge-by-mis-tei", undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/guidellm/).length).toBeGreaterThanOrEqual(1), {
      timeout: 5000,
    });

    // Subtitle renders both baseUrl and model: "http://x · m1".
    expect(screen.getByText(/http:\/\/x.*m1/)).toBeInTheDocument();
    expect(screen.getAllByText(/vegeta/).length).toBeGreaterThanOrEqual(1);

    // Chart placeholder receives 2 points (both completed runs carry p95).
    const chart = screen.getByTestId("p95-chart");
    expect(chart).toHaveAttribute("data-len", "2");

    // Run history table has both rows (links to detail).
    expect(screen.getByRole("link", { name: "alpha" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "beta" })).toBeInTheDocument();
  });

  it("'Back to insights' link points to /benchmarks/reports", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith("/api/connections/")) return Promise.resolve(conn) as never;
      return Promise.resolve({ items: [], nextCursor: null }) as never;
    });
    const wrap = withProviders();
    render(wrap(<TestInsightsDetailPage />));
    const back = await screen.findByRole("link", {
      name: /Back to Test Insights|返回测试洞察/i,
    });
    expect(back).toHaveAttribute("href", "/benchmarks/reports");
  });
});
