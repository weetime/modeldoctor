import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n";
import { EvaluationsListPage } from "../EvaluationsListPage";

vi.mock("../queries", () => ({
  useEvaluations: vi.fn(),
  useDeleteEvaluation: () => ({ mutate: vi.fn() }),
}));
import { useEvaluations } from "../queries";

beforeAll(async () => {
  await i18n.changeLanguage("zh-CN");
});

function Provider({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>{children}</MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

describe("EvaluationsListPage", () => {
  it("shows empty state when no items", () => {
    (useEvaluations as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [],
      isLoading: false,
    });
    render(<EvaluationsListPage />, { wrapper: Provider });
    expect(screen.getByText(/还没有评测集/)).toBeInTheDocument();
  });

  it("renders rows with detail link", () => {
    (useEvaluations as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [
        {
          id: "e1",
          userId: "u1",
          name: "Demo",
          description: null,
          version: 1,
          samples: [],
          totalSamples: 4,
          createdAt: "2026-05-12T00:00:00Z",
          updatedAt: "2026-05-12T00:00:00Z",
        },
      ],
      isLoading: false,
    });
    render(<EvaluationsListPage />, { wrapper: Provider });
    const link = screen.getByRole("link", { name: "Demo" });
    expect(link).toHaveAttribute("href", "/quality-gate/evaluations/e1");
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("delete button opens AlertDialog with name in title", () => {
    (useEvaluations as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [
        {
          id: "e1",
          userId: "u1",
          name: "Demo",
          description: null,
          version: 1,
          samples: [],
          totalSamples: 1,
          createdAt: "2026-05-12T00:00:00Z",
          updatedAt: "2026-05-12T00:00:00Z",
        },
      ],
      isLoading: false,
    });
    render(<EvaluationsListPage />, { wrapper: Provider });
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.getByText(/删除 Demo？/)).toBeInTheDocument();
  });
});
