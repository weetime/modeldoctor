// apps/web/src/features/insights/InsightsMatrixPage.test.tsx
import type { InsightsMatrixResponse } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";

const { matrixQueryRef, profilesQueryRef } = vi.hoisted(() => ({
  matrixQueryRef: { current: { data: undefined, isLoading: true } } as {
    current: { data: unknown; isLoading: boolean };
  },
  profilesQueryRef: { current: { data: undefined, isLoading: true } } as {
    current: { data: unknown; isLoading: boolean };
  },
}));

vi.mock("./matrix-queries", () => ({
  useInsightsMatrix: () => matrixQueryRef.current,
}));

vi.mock("./queries", () => ({
  useEvaluationProfiles: () => profilesQueryRef.current,
}));

import { InsightsMatrixPage } from "./InsightsMatrixPage";

const MATRIX_FIXTURE: InsightsMatrixResponse = {
  aggregate: "scenario",
  range: "30d",
  generatedAt: "2026-07-01T00:00:00Z",
  dimensions: [{ key: "inference", label: "Inference", count: 1 }],
  endpoints: [
    {
      id: "c1",
      name: "n",
      model: "m",
      baseUrl: "http://x",
      category: "chat",
      serverKind: "vllm",
    },
  ],
  cells: [
    {
      endpointId: "c1",
      dimKey: "inference",
      runs: 3,
      score: 80,
      band: "usable",
      nativeMetric: { kind: "e2e.p95", value: 1200, unit: "ms" },
    },
  ],
};

function renderPage(initialUrl = "/insights") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[initialUrl]}>
          <InsightsMatrixPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe("InsightsMatrixPage", () => {
  it("renders endpoint row and scenario column header", async () => {
    matrixQueryRef.current = { data: MATRIX_FIXTURE, isLoading: false };
    profilesQueryRef.current = { data: { items: [] }, isLoading: false };

    renderPage();

    expect(await screen.findByText("m")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /inference/i })).toBeInTheDocument();
  });
});
