import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BenchmarkCreatePage } from "../BenchmarkCreatePage";

vi.mock("@/features/connections/queries", () => ({
  useConnections: () => ({
    data: [{ id: "c1", name: "test-conn", baseUrl: "http://x", model: "m" }],
    isLoading: false,
  }),
}));

const mockMutate = vi.fn();
vi.mock("../queries", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useCreateBenchmark: () => ({
      mutate: mockMutate,
      mutateAsync: mockMutate,
      isPending: false,
    }),
  };
});

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("BenchmarkCreatePage", () => {
  it("renders endpoint, tool, name, description sections", () => {
    render(<BenchmarkCreatePage />, { wrapper: Wrapper });
    expect(screen.getByText(/Endpoint/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Tool/i).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Name/i)).toBeInTheDocument();
  });

  it("disables submit when no connection selected", () => {
    render(<BenchmarkCreatePage />, { wrapper: Wrapper });
    const submit = screen.getByRole("button", { name: /Submit/i });
    expect(submit).toBeDisabled();
  });
});
