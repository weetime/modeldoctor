import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EvaluationCreatePage } from "../EvaluationCreatePage";

vi.mock("../queries", () => ({
  useCreateEvaluation: () => ({ mutateAsync: vi.fn().mockResolvedValue({ id: "e1" }) }),
  useImportEvaluation: () => ({ mutateAsync: vi.fn() }),
}));

function Provider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{children}</MemoryRouter>
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
