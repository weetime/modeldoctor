import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { SaveCompareDialog } from "./SaveCompareDialog";

vi.mock("@/lib/api-client", () => ({
  api: { post: vi.fn(async () => ({ id: "scNEW" })), get: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));

function Loc() {
  const l = useLocation();
  return <div data-testid="loc">{l.pathname + l.search}</div>;
}

function renderDialog(generateAfterSave: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={["/benchmarks/compare?ids=b1,b2"]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route
            path="/benchmarks/compare"
            element={
              <SaveCompareDialog
                open
                onOpenChange={() => {}}
                runs={[
                  { id: "b1", name: "r1", tool: "guidellm" },
                  { id: "b2", name: "r2", tool: "guidellm" },
                ]}
                baselineId="b1"
                context=""
                generateAfterSave={generateAfterSave}
              />
            }
          />
          <Route path="/reports/:id" element={<Loc />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// NOTE: test env uses en-US fallback locale; labels/buttons are in English.
// - Name label: "Name" (savedCompare.dialog.nameLabel)
// - Submit button (saveOnly): "Save and view" (savedCompare.dialog.submit)
// - Submit button (generate): "Save & generate" (savedCompare.dialog.submitGenerate)
// Per-run inputs have aria-label={r.name ?? r.id} so getByLabelText("r1") works.

// Matches exactly "Save and view" OR "Save & generate" (en-US fallback values).
const submitButton = () =>
  screen.getByRole("button", { name: /^(?:Save and view|Save & generate)$/ });

async function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("Name", { selector: "#sc-name" }), {
    target: { value: "X" },
  });
  fireEvent.change(screen.getByLabelText("r1"), { target: { value: "A" } });
  fireEvent.change(screen.getByLabelText("r2"), { target: { value: "B" } });
  fireEvent.click(submitButton());
}

describe("SaveCompareDialog navigation", () => {
  it("navigates to the saved page without generate flag when generateAfterSave is false", async () => {
    renderDialog(false);
    await fillAndSubmit();
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/reports/scNEW"));
    expect(screen.getByTestId("loc")).not.toHaveTextContent("generate=1");
  });

  it("appends ?generate=1 when generateAfterSave is true", async () => {
    renderDialog(true);
    await fillAndSubmit();
    await waitFor(() =>
      expect(screen.getByTestId("loc")).toHaveTextContent("/reports/scNEW?generate=1"),
    );
  });
});

describe("SaveCompareDialog validation", () => {
  it("submit is disabled until name and all labels provided", async () => {
    const u = userEvent.setup();
    renderDialog(false);

    // Initially disabled — no name, no run labels filled
    expect(submitButton()).toBeDisabled();

    // Fill name only — still disabled
    await u.type(screen.getByLabelText("Name", { selector: "#sc-name" }), "Study A");
    expect(submitButton()).toBeDisabled();

    // Fill run-a label — still disabled (run-b missing)
    await u.type(screen.getByLabelText("r1"), "A");
    expect(submitButton()).toBeDisabled();

    // Fill run-b label — now all three fields have values, submit should be enabled
    await u.type(screen.getByLabelText("r2"), "B");
    expect(submitButton()).not.toBeDisabled();
  });
});

describe("SaveCompareDialog state seeding", () => {
  function Harness() {
    // New `runs` array reference on every render — mirrors BenchmarkComparePage's
    // inline `.map()`, which a background React Query refetch re-creates.
    const runs = [
      { id: "b1", name: "r1", tool: "guidellm", label: "A" },
      { id: "b2", name: "r2", tool: "guidellm", label: "B" },
    ];
    return (
      <SaveCompareDialog open onOpenChange={() => {}} runs={runs} baselineId="b1" context="" />
    );
  }

  it("seeds label inputs from the derived `label` on open", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <Harness />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("r1")).toHaveValue("A");
    expect(screen.getByLabelText("r2")).toHaveValue("B");
  });

  it("keeps user edits across a parent re-render while open (fresh runs ref)", async () => {
    const u = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <Harness />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const input = screen.getByLabelText("r1");
    await u.clear(input);
    await u.type(input, "Edited");
    expect(input).toHaveValue("Edited");

    // Parent re-render with a brand-new `runs` reference must NOT re-seed.
    rerender(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <Harness />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("r1")).toHaveValue("Edited");
  });
});
