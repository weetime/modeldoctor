import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetBaselineDialog } from "../SetBaselineDialog";

const mockMutate = vi.fn();
vi.mock("@/features/baseline/queries", () => ({
  useCreateBaseline: () => ({ mutate: mockMutate, isPending: false }),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SetBaselineDialog", () => {
  beforeEach(() => mockMutate.mockReset());

  it("renders required asterisk on Name", () => {
    render(<SetBaselineDialog benchmarkId="b1" open onOpenChange={() => {}} />, {
      wrapper: Wrapper,
    });
    const stars = screen.getAllByText("*", { selector: "span" });
    expect(stars.length).toBeGreaterThanOrEqual(1);
  });

  it("submit button is disabled until name has a value", async () => {
    const user = userEvent.setup();
    render(<SetBaselineDialog benchmarkId="b1" open onOpenChange={() => {}} />, {
      wrapper: Wrapper,
    });
    // The submit label comes from i18n; en-US falls back. Match by being the
    // form's submit button (disabled by default).
    const buttons = screen.getAllByRole("button");
    const submit = buttons.find((b) => (b as HTMLButtonElement).type === "submit");
    expect(submit).toBeDefined();
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/Name/i), "v1");
    expect(submit).not.toBeDisabled();
  });

  it("shows required error when name is blurred while empty", async () => {
    const user = userEvent.setup();
    render(<SetBaselineDialog benchmarkId="b1" open onOpenChange={() => {}} />, {
      wrapper: Wrapper,
    });
    const nameInput = screen.getByLabelText(/Name/i);
    await user.click(nameInput);
    await user.tab();
    expect(await screen.findByText(/required/i)).toBeInTheDocument();
  });

  it("calls createBaseline with {benchmarkId, name, description, tags} on submit", async () => {
    const user = userEvent.setup();
    render(<SetBaselineDialog benchmarkId="r_1" open onOpenChange={() => {}} />, {
      wrapper: Wrapper,
    });
    await user.type(screen.getByLabelText(/Name/i), "anchor");
    await user.type(screen.getByLabelText(/Description/i), "desc");
    await user.type(screen.getByLabelText(/Tags/i), "a, b");
    const submit = screen
      .getAllByRole("button")
      .find((b) => (b as HTMLButtonElement).type === "submit") as HTMLButtonElement;
    await user.click(submit);
    expect(mockMutate).toHaveBeenCalledWith(
      { benchmarkId: "r_1", name: "anchor", description: "desc", tags: ["a", "b"] },
      expect.any(Object),
    );
  });

  it("does not submit when name is empty", async () => {
    const user = userEvent.setup();
    render(<SetBaselineDialog benchmarkId="r_1" open onOpenChange={() => {}} />, {
      wrapper: Wrapper,
    });
    const submit = screen
      .getAllByRole("button")
      .find((b) => (b as HTMLButtonElement).type === "submit") as HTMLButtonElement;
    await user.click(submit);
    expect(mockMutate).not.toHaveBeenCalled();
  });
});
