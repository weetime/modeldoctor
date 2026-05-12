import i18n from "@/lib/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { EvaluationCreatePage } from "../EvaluationCreatePage";

vi.mock("../queries", () => ({
  useCreateEvaluation: () => ({ mutateAsync: vi.fn().mockResolvedValue({ id: "e1" }) }),
  useImportEvaluation: () => ({ mutateAsync: vi.fn() }),
}));

beforeAll(async () => {
  await i18n.changeLanguage("zh-CN");
});

function Provider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>{children}</MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

describe("EvaluationCreatePage", () => {
  it("renders save button disabled when name empty", () => {
    render(<EvaluationCreatePage />, { wrapper: Provider });
    const save = screen.getByRole("button", { name: "保存" });
    expect(save).toBeDisabled();
  });
  it("shows import buttons", () => {
    render(<EvaluationCreatePage />, { wrapper: Provider });
    expect(screen.getByText("从 JSON 导入")).toBeInTheDocument();
    expect(screen.getByText("从 CSV 导入")).toBeInTheDocument();
  });
});
