import i18n from "@/lib/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { RunsListPage } from "../RunsListPage";

vi.mock("../queries", () => ({
  useRuns: () => ({
    data: {
      items: [
        {
          id: "r1",
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
          id: "r2",
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
  it("renders runs in a table with a checkbox per row", () => {
    render(<RunsListPage />, { wrapper: P });
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("shows compare toolbar when ≥1 row selected", async () => {
    render(<RunsListPage />, { wrapper: P });
    const checkboxes = screen.getAllByRole("checkbox");
    await userEvent.click(checkboxes[0]);
    expect(screen.getByText(/已选 1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /对比所选/ })).toBeDisabled();
    await userEvent.click(checkboxes[1]);
    expect(screen.getByRole("button", { name: /对比所选/ })).toBeEnabled();
  });
});
