import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BenchmarkCreatePage } from "../BenchmarkCreatePage";

vi.mock("@/features/connections/queries", () => ({
  useConnections: () => ({
    data: [{ id: "c1", name: "test-conn", baseUrl: "http://x", model: "m" }],
    isLoading: false,
  }),
  useConnection: () => ({ data: null }),
  useCreateConnection: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useUpdateConnection: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
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
  it("renders target, tool, name, description sections", () => {
    render(<BenchmarkCreatePage />, { wrapper: Wrapper });
    // Endpoint + tool now collapse into a single "Target" card.
    expect(screen.getByText(/Target|目标/)).toBeInTheDocument();
    expect(screen.getAllByText(/Tool/i).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Name/i)).toBeInTheDocument();
  });

  it("disables submit when no connection selected", () => {
    render(<BenchmarkCreatePage />, { wrapper: Wrapper });
    const submit = screen.getByRole("button", { name: /Submit/i });
    expect(submit).toBeDisabled();
  });

  it("defaults to inference scenario when no ?scenario= param (tool select shows guidellm)", () => {
    renderAt("/benchmarks/new");
    // Inference is multi-tool (guidellm + genai-perf), so the dropdown is
    // rendered as a combobox with the default-selected value visible.
    const toolCombo = screen.getByRole("combobox", { name: /Tool/i });
    expect(within(toolCombo).getByText(/guidellm/i)).toBeInTheDocument();
  });

  it("narrows tool select to guidellm only when ?scenario=capacity", () => {
    renderAt("/benchmarks/new?scenario=capacity");
    // Capacity has a single tool (guidellm), so the dropdown is replaced by a
    // read-only label — there should be no combobox in the Tool section.
    expect(screen.queryByRole("combobox", { name: /Tool/i })).not.toBeInTheDocument();
    const label = screen.getByLabelText(/Tool/i);
    expect(label).toHaveTextContent(/guidellm/i);
  });

  it("narrows tool select to vegeta only when ?scenario=gateway", () => {
    renderAt("/benchmarks/new?scenario=gateway");
    expect(screen.queryByRole("combobox", { name: /Tool/i })).not.toBeInTheDocument();
    const label = screen.getByLabelText(/Tool/i);
    expect(label).toHaveTextContent(/vegeta/i);
  });

  it("falls back to inference when ?scenario= is invalid", () => {
    renderAt("/benchmarks/new?scenario=foo");
    // Falls back to inference → multi-tool dropdown rendered.
    const toolCombo = screen.getByRole("combobox", { name: /Tool/i });
    expect(within(toolCombo).getByText(/guidellm/i)).toBeInTheDocument();
  });

  it("renders VegetaParamsForm fields when ?scenario=gateway", () => {
    renderAt("/benchmarks/new?scenario=gateway");
    // VegetaParamsForm exposes a "Rate (req/s)" field that no other params
    // form has — distinctive enough to confirm the right subform mounted.
    expect(screen.getByLabelText(/Rate \(req\/s\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Duration \(s\)/i)).toBeInTheDocument();
    // GuidellmParamsForm's "Profile" field MUST NOT be present.
    expect(screen.queryByLabelText(/^Profile$/i)).not.toBeInTheDocument();
  });

  it("renders GuidellmParamsForm fields when ?scenario=capacity", () => {
    renderAt("/benchmarks/new?scenario=capacity");
    // GuidellmParamsForm exposes a "Profile" field that vegeta/genai-perf
    // forms don't — distinctive enough to confirm the right subform mounted.
    expect(screen.getByLabelText(/^Profile$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Request rate/i)).toBeInTheDocument();
    // VegetaParamsForm's "Rate (req/s)" field MUST NOT be present.
    expect(screen.queryByLabelText(/Rate \(req\/s\)/i)).not.toBeInTheDocument();
  });

  it("renders red asterisk on required Connection / Name labels", () => {
    render(<BenchmarkCreatePage />, { wrapper: Wrapper });
    // <FormLabel required> renders text + a span containing "*"
    const labels = screen.getAllByText("*", { selector: "span" });
    expect(labels.length).toBeGreaterThanOrEqual(2); // connection + name
  });

  it("shows required error under Name when blurred while empty", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<BenchmarkCreatePage />, { wrapper: Wrapper });
    const nameInput = screen.getByLabelText(/Name/i);
    await user.click(nameInput);
    await user.tab();
    expect(await screen.findByText(/required/i)).toBeInTheDocument();
  });

  it("resets form when ?scenario= URL changes (regression for stale tool)", () => {
    // This test exercises the useEffect that calls form.reset() on scenario
    // change — the BenchmarkCreatePage instance stays mounted across the
    // URL change (no remount), so a stale `tool` would survive without the
    // reset. We trigger navigation programmatically inside the same
    // MemoryRouter tree to keep the page mounted.
    let navigateRef: ((to: string) => void) | null = null;
    function NavCapture() {
      const navigate = useNavigate();
      navigateRef = (to: string) => navigate(to);
      return null;
    }

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/benchmarks/new?scenario=inference"]}>
          <NavCapture />
          <BenchmarkCreatePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Initial: inference → multi-tool combobox showing guidellm.
    const initialCombo = screen.getByRole("combobox", { name: /Tool/i });
    expect(within(initialCombo).getByText(/guidellm/i)).toBeInTheDocument();

    // Navigate to gateway in the same tree. The form.reset useEffect must
    // fire and switch the tool to vegeta (single-tool readonly indicator).
    act(() => {
      navigateRef?.("/benchmarks/new?scenario=gateway");
    });

    expect(screen.queryByRole("combobox", { name: /Tool/i })).not.toBeInTheDocument();
    const label = screen.getByLabelText(/Tool/i);
    expect(label).toHaveTextContent(/vegeta/i);
    // And the VegetaParamsForm should now be the rendered subform.
    expect(screen.getByLabelText(/Rate \(req\/s\)/i)).toBeInTheDocument();
  });
});
