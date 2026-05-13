import i18n from "@/lib/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { EvaluationsListPage } from "../EvaluationsListPage";

vi.mock("../queries", () => ({
  useEvaluations: vi.fn(),
  useDeleteEvaluation: () => ({ mutate: vi.fn() }),
  useDuplicateEvaluation: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

const userEval = {
  id: "e1",
  userId: "u1",
  name: "Demo",
  description: null,
  version: 1,
  samples: [],
  totalSamples: 4,
  isOfficial: false,
  createdAt: "2026-05-12T00:00:00Z",
  updatedAt: "2026-05-12T00:00:00Z",
};

const officialEval = {
  id: "e2",
  userId: "usr_system_seed_00000000000",
  name: "Built-in",
  description: "official zh-CN demo",
  version: 1,
  samples: [],
  totalSamples: 8,
  isOfficial: true,
  createdAt: "2026-05-12T00:00:00Z",
  updatedAt: "2026-05-12T00:00:00Z",
};

describe("EvaluationsListPage", () => {
  it("shows empty state when no items", () => {
    (useEvaluations as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [],
      isLoading: false,
    });
    render(<EvaluationsListPage />, { wrapper: Provider });
    expect(screen.getByText(/还没有评测集/)).toBeInTheDocument();
  });

  it("renders rows with detail link and sample count", () => {
    (useEvaluations as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [userEval],
      isLoading: false,
    });
    render(<EvaluationsListPage />, { wrapper: Provider });
    const link = screen.getByRole("link", { name: "Demo" });
    expect(link).toHaveAttribute("href", "/quality-gate/evaluations/e1");
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("delete button opens AlertDialog with name in title (user-owned row)", () => {
    (useEvaluations as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [userEval],
      isLoading: false,
    });
    render(<EvaluationsListPage />, { wrapper: Provider });
    fireEvent.click(screen.getByRole("button", { name: /删除/ }));
    expect(screen.getByText(/删除 Demo？/)).toBeInTheDocument();
  });

  it("renders official badge and shows Copy button instead of Delete on official rows", () => {
    (useEvaluations as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [officialEval],
      isLoading: false,
    });
    render(<EvaluationsListPage />, { wrapper: Provider });
    expect(screen.getByText("官方")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /复制为我的/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /删除/ })).not.toBeInTheDocument();
  });
});
