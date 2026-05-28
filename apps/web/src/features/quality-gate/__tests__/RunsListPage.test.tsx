import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { RunsListPage } from "../RunsListPage";

vi.mock("../queries", () => ({
  useRuns: () => ({
    data: {
      items: [
        {
          id: "r1abc123def456",
          status: "COMPLETED",
          createdAt: "2026-05-12T00:00:00Z",
          processedSamples: 3,
          totalSamples: 3,
          gateResult: "PASSED",
          aggregateMetrics: {
            passRateA: 1,
            bothPassCount: 3,
            bothFailCount: 0,
            totalErrors: 0,
            judgeCallCount: 3,
          },
          evaluation: { id: "e1", name: "Demo Eval" },
          endpointA: { id: "c1", name: "Local", model: "qwen2.5-7b", baseUrl: "http://x" },
          endpointB: null,
        },
        {
          id: "r2xyz789ghi012",
          status: "COMPLETED",
          createdAt: "2026-05-13T00:00:00Z",
          processedSamples: 3,
          totalSamples: 3,
          gateResult: "PASSED",
          aggregateMetrics: {
            passRateA: 1,
            bothPassCount: 3,
            bothFailCount: 0,
            totalErrors: 0,
            judgeCallCount: 3,
          },
          evaluation: { id: "e1", name: "Demo Eval" },
          endpointA: { id: "c1", name: "Local", model: "qwen2.5-7b", baseUrl: "http://x" },
          endpointB: null,
        },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    },
    isLoading: false,
  }),
  useDeleteRun: () => ({ mutate: vi.fn() }),
  useEvaluations: () => ({ data: [{ id: "e1", name: "Demo Eval" }] }),
}));

vi.mock("@/features/connections/queries", () => ({
  useConnections: () => ({
    data: [{ id: "c1", name: "Local", model: "qwen2.5-7b", baseUrl: "http://x" }],
  }),
  useVerifyKind: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

beforeAll(async () => {
  await i18n.changeLanguage("zh-CN");
});

function P({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>{children}</MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

describe("RunsListPage", () => {
  it("renders one row per run with id-link to detail page", () => {
    render(<RunsListPage />, { wrapper: P });
    expect(screen.getByText("r1abc123def4")).toBeInTheDocument();
    expect(screen.getByText("r2xyz789ghi0")).toBeInTheDocument();
  });
});
