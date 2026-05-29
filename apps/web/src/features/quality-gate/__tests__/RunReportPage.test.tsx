import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { RunReportPage } from "../RunReportPage";

const mockRun = {
  id: "r1",
  userId: "u1",
  evaluationId: "e1",
  evaluationVersion: 1,
  evaluationSnapshot: { samples: [] },
  endpointAId: "a",
  endpointBId: null,
  gateConfig: { passRateMin: 0.9 },
  genConfig: { maxTokens: 2048, temperature: 0, thinking: "auto" as const },
  status: "COMPLETED" as const,
  gateResult: "PASSED" as const,
  aggregateMetrics: {
    passRateA: 0.95,
    bothPassCount: 0,
    bothFailCount: 0,
    totalErrors: 0,
    judgeCallCount: 0,
  },
  processedSamples: 1,
  totalSamples: 1,
  startedAt: "2026-05-12T00:00:00Z",
  finishedAt: "2026-05-12T00:00:01Z",
  baselineRunIdAtExecution: null,
  errorMessage: null,
  createdAt: "2026-05-12T00:00:00Z",
};
const mockSamples = { items: [], total: 0, page: 1, pageSize: 500 };

vi.mock("../queries", () => ({
  useRun: () => ({ data: mockRun }),
  useCancelRun: () => ({ mutate: vi.fn() }),
  useRunSamples: () => ({ data: mockSamples }),
}));

beforeAll(async () => {
  await i18n.changeLanguage("zh-CN");
});

function wrap() {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={["/quality-gate/runs/r1"]}>
          <Routes>
            <Route path="/quality-gate/runs/:id" element={<RunReportPage />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

describe("RunReportPage", () => {
  it("renders gate badge for PASSED", () => {
    render(wrap());
    // GateStatusBadge renders "通过" for PASSED
    expect(screen.getAllByText(/通过/).length).toBeGreaterThan(0);
  });
});
