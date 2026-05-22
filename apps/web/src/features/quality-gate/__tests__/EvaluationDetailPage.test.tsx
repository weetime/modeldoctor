import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { EvaluationDetailPage } from "../EvaluationDetailPage";

const userEval = {
  id: "e1",
  userId: "u1",
  name: "Demo",
  description: "desc",
  version: 1,
  samples: [
    {
      id: "s0",
      idx: 0,
      prompt: "Q",
      expected: "A",
      judgeConfig: { kind: "exact-match" as const },
    },
  ],
  totalSamples: 1,
  isOfficial: false,
  createdAt: "2026-05-12T00:00:00Z",
  updatedAt: "2026-05-12T00:00:00Z",
};

const officialEval = {
  ...userEval,
  id: "e2",
  userId: "usr_system_seed_00000000000",
  name: "Built-in zh-CN",
  isOfficial: true,
};

let evaluationFixture = userEval as typeof userEval | typeof officialEval;

vi.mock("../queries", () => ({
  useEvaluation: () => ({ data: evaluationFixture }),
  useUpdateEvaluation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDuplicateEvaluation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

beforeAll(async () => {
  await i18n.changeLanguage("zh-CN");
});

function wrap() {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={["/quality-gate/evaluations/e1"]}>
          <Routes>
            <Route path="/quality-gate/evaluations/:id" element={<EvaluationDetailPage />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

describe("EvaluationDetailPage", () => {
  it("prefills name from data", () => {
    evaluationFixture = userEval;
    render(wrap());
    expect(screen.getByDisplayValue("Demo")).toBeInTheDocument();
  });

  it("renders sample preview row (compact table)", () => {
    evaluationFixture = userEval;
    render(wrap());
    expect(screen.getByText("Q")).toBeInTheDocument();
  });

  it("clicking row Edit opens drawer with full sample editor", () => {
    evaluationFixture = userEval;
    render(wrap());
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    expect(screen.getByDisplayValue("Q")).toBeInTheDocument();
    expect(screen.getByDisplayValue("A")).toBeInTheDocument();
  });

  it("official evaluation renders read-only banner + Copy button and hides sticky Save bar", () => {
    evaluationFixture = officialEval;
    render(wrap());
    expect(screen.getByRole("button", { name: /复制为我的/ })).toBeInTheDocument();
    expect(screen.getByText(/平台内置的官方评测集/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
  });
});
