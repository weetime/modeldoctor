import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
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

function renderAt(initialEntry: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <BenchmarkCreatePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

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

  it("defaults to inference scenario when no ?scenario= param (tool select shows guidellm)", () => {
    renderAt("/runs/new");
    // Inference is multi-tool (guidellm + genai-perf), so the dropdown is
    // rendered as a combobox with the default-selected value visible.
    const toolCombo = screen.getByRole("combobox", { name: /Tool/i });
    expect(within(toolCombo).getByText(/guidellm/i)).toBeInTheDocument();
  });

  it("narrows tool select to guidellm only when ?scenario=capacity", () => {
    renderAt("/runs/new?scenario=capacity");
    // Capacity has a single tool (guidellm), so the dropdown is replaced by a
    // read-only label — there should be no combobox in the Tool section.
    expect(screen.queryByRole("combobox", { name: /Tool/i })).not.toBeInTheDocument();
    const label = screen.getByLabelText(/Tool/i);
    expect(label).toHaveTextContent(/guidellm/i);
  });

  it("narrows tool select to vegeta only when ?scenario=gateway", () => {
    renderAt("/runs/new?scenario=gateway");
    expect(screen.queryByRole("combobox", { name: /Tool/i })).not.toBeInTheDocument();
    const label = screen.getByLabelText(/Tool/i);
    expect(label).toHaveTextContent(/vegeta/i);
  });

  it("falls back to inference when ?scenario= is invalid", () => {
    renderAt("/runs/new?scenario=foo");
    // Falls back to inference → multi-tool dropdown rendered.
    const toolCombo = screen.getByRole("combobox", { name: /Tool/i });
    expect(within(toolCombo).getByText(/guidellm/i)).toBeInTheDocument();
  });
});
