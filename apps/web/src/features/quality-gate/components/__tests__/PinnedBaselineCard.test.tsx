import i18n from "@/lib/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PinnedBaselineCard } from "../PinnedBaselineCard";

const mockRun = {
  id: "baseline-run-123",
  status: "COMPLETED" as const,
  gateResult: "PASSED" as const,
  createdAt: "2026-05-10T14:23:00Z",
};

vi.mock("../../queries", () => ({
  useRun: () => ({ data: mockRun }),
  useSetBaseline: () => ({ mutateAsync: vi.fn() }),
  useRuns: () => ({ data: { items: [] } }),
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

describe("PinnedBaselineCard", () => {
  it("renders baseline run summary with three action buttons", () => {
    render(<PinnedBaselineCard evaluationId="e1" baselineRunId="baseline-run-123" />, {
      wrapper: P,
    });
    expect(screen.getByText(/Pinned Baseline/)).toBeInTheDocument();
    expect(screen.getByText(/baseline-run/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /查看 run/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /更改/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /解钉/ })).toBeInTheDocument();
  });
});
