import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return { ApiError, api: { get: vi.fn(), post: vi.fn(), del: vi.fn() } };
});

import { api } from "@/lib/api-client";
import { BenchmarkCreateModal } from "../BenchmarkCreateModal";

function Wrapper({
  children,
  initialEntries = ["/benchmarks"],
}: {
  children: ReactNode;
  initialEntries?: string[];
}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/benchmarks" element={children} />
          <Route
            path="/benchmarks/:id"
            element={<div>detail page for navigation target</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("BenchmarkCreateModal — basic tab", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it("is closed by default", () => {
    render(<BenchmarkCreateModal />, { wrapper: Wrapper });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens when ?create=1 is in the URL", () => {
    render(<BenchmarkCreateModal />, {
      wrapper: ({ children }) => (
        <Wrapper initialEntries={["/benchmarks?create=1"]}>{children}</Wrapper>
      ),
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/new benchmark/i)).toBeInTheDocument();
  });

  it("renders both tab triggers", () => {
    render(<BenchmarkCreateModal />, {
      wrapper: ({ children }) => (
        <Wrapper initialEntries={["/benchmarks?create=1"]}>{children}</Wrapper>
      ),
    });
    expect(screen.getByRole("tab", { name: /basic info/i })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /configuration/i }),
    ).toBeInTheDocument();
  });

  it("closes when Cancel is clicked and clears the URL search param", async () => {
    render(<BenchmarkCreateModal />, {
      wrapper: ({ children }) => (
        <Wrapper initialEntries={["/benchmarks?create=1"]}>{children}</Wrapper>
      ),
    });
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
