import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { SavedCompareDetailPage } from "./SavedCompareDetailPage";

vi.mock("echarts-for-react", () => ({
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echart" data-option={JSON.stringify(option)} />
  ),
}));

vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(async (path: string) => {
      if (path.startsWith("/api/saved-compares/")) {
        return {
          id: "sc1",
          userId: "u",
          name: "Study A",
          benchmarkIds: ["b1", "b2"],
          stageLabels: { b1: "A", b2: "B" },
          baselineId: "b1",
          context: "8x NPU",
          narrative: null,
          narrativeAt: null,
          createdAt: "2026-05-12T00:00:00.000Z",
          updatedAt: "2026-05-12T00:00:00.000Z",
          benchmarks: [
            {
              id: "b1",
              stageLabel: "A",
              missing: false,
              name: "r1",
              tool: "guidellm",
              scenario: "inference",
              params: {},
              summaryMetrics: { tool: "guidellm", data: { ttft: { p50: 100, p90: 200, p99: 500 } } },
              createdAt: "2026-05-12T00:00:00.000Z",
            },
            {
              id: "b2",
              stageLabel: "B",
              missing: false,
              name: "r2",
              tool: "guidellm",
              scenario: "inference",
              params: {},
              summaryMetrics: { tool: "guidellm", data: { ttft: { p50: 80, p90: 160, p99: 400 } } },
              createdAt: "2026-05-12T00:00:00.000Z",
            },
          ],
        };
      }
      if (path === "/api/llm-judge-providers/active") {
        return { id: "p", enabled: true };
      }
      throw new Error("unmocked: " + path);
    }),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
}));

describe("SavedCompareDetailPage", () => {
  it("renders the report once data loads", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter initialEntries={["/benchmarks/compare/saved/sc1"]}>
        <QueryClientProvider client={qc}>
          <Routes>
            <Route
              path="/benchmarks/compare/saved/:id"
              element={<SavedCompareDetailPage />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "Study A" })).toBeInTheDocument(),
    );
    expect(screen.getByText(/8x NPU/)).toBeInTheDocument();
  });
});
