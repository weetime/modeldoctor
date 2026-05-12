import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RunsListPage } from "../RunsListPage";

const emptyData = { items: [], total: 0, page: 1, pageSize: 20 };
vi.mock("../queries", () => ({
  useRuns: () => ({ data: emptyData, isLoading: false }),
  useDeleteRun: () => ({ mutate: vi.fn() }),
}));

function P({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("RunsListPage", () => {
  it("shows empty state", () => {
    render(<RunsListPage />, { wrapper: P });
    expect(screen.getByText(/还没有评测运行/)).toBeInTheDocument();
  });
});
