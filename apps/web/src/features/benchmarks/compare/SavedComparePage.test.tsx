import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { SavedComparePage } from "./SavedComparePage";

const state = vi.hoisted(() => ({ narrative: null as unknown }));

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
          narrative: state.narrative,
          narrativeAt: state.narrative ? "2026-05-12T00:00:00.000Z" : null,
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
              summaryMetrics: {
                tool: "guidellm",
                data: { ttft: { p50: 100, p90: 200, p99: 500 } },
              },
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
              summaryMetrics: {
                tool: "guidellm",
                data: { ttft: { p50: 80, p90: 160, p99: 400 } },
              },
              createdAt: "2026-05-12T00:00:00.000Z",
            },
          ],
        };
      }
      if (path === "/api/llm-judge/provider") return { id: "p", enabled: true };
      throw new Error(`unmocked: ${path}`);
    }),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
}));

beforeEach(() => {
  state.narrative = null;
});

function renderAt(entry: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/benchmarks/compare/saved/:id" element={<SavedComparePage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("SavedComparePage", () => {
  it("renders the raw data once loaded", async () => {
    renderAt("/benchmarks/compare/saved/sc1");
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "Study A" })).toBeInTheDocument(),
    );
    expect(screen.getByText(/8x NPU/)).toBeInTheDocument();
  });

  it("renders the AI narrative inline when present", async () => {
    state.narrative = {
      schemaVersion: 2,
      locale: "zh-CN",
      hero: { eyebrow: "EB", title: "Inline Hero", subtitle: "S", metaItems: [] },
      summaryCards: [],
      sections: [{ id: "summary", num: "01", title: "Summary", bodyMarkdown: "x" }],
      figures: [],
      lintWarnings: [],
    };
    renderAt("/benchmarks/compare/saved/sc1");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Inline Hero" })).toBeInTheDocument(),
    );
  });
});
