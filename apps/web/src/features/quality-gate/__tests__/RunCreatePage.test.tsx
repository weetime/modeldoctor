import i18n from "@/lib/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { RunCreatePage } from "../RunCreatePage";

const mockEvaluations = [{ id: "e1", name: "demo", totalSamples: 2 }];
const mockConnections = [{ id: "c1", name: "endpoint-a" }];

vi.mock("../queries", () => ({
  useEvaluations: () => ({ data: mockEvaluations }),
  useEvaluation: () => ({ data: null }),
  useRuns: () => ({ data: { items: [] } }),
  useCreateRun: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ id: "r1" }),
    isPending: false,
  }),
}));

vi.mock("@/features/connections/queries", () => ({
  useConnections: () => ({ data: mockConnections, isLoading: false }),
  useConnection: () => ({ data: null }),
  useCreateConnection: () => ({ mutateAsync: vi.fn() }),
  useUpdateConnection: () => ({ mutateAsync: vi.fn() }),
  useDeleteConnection: () => ({ mutateAsync: vi.fn() }),
  useRevealApiKey: () => ({ mutateAsync: vi.fn() }),
  useDiscoverConnection: () => ({ mutateAsync: vi.fn() }),
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

describe("RunCreatePage", () => {
  it("renders trigger button disabled when no evaluation/endpoint picked", () => {
    render(<RunCreatePage />, { wrapper: P });
    const trigger = screen.getByRole("button", { name: "触发评测" });
    expect(trigger).toBeDisabled();
  });

  it("renders gate config section heading", () => {
    render(<RunCreatePage />, { wrapper: P });
    expect(screen.getByText("门禁规则")).toBeInTheDocument();
  });
});
