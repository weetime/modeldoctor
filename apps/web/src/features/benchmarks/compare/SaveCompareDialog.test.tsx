import "@/lib/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SaveCompareDialog } from "./SaveCompareDialog";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>
  );
}

describe("SaveCompareDialog", () => {
  const runs = [
    { id: "r1", name: "run-a", tool: "guidellm" },
    { id: "r2", name: "run-b", tool: "guidellm" },
  ];

  it("renders one stage-label input per run", () => {
    render(
      wrap(
        <SaveCompareDialog open onOpenChange={() => {}} runs={runs} baselineId="r1" context="" />,
      ),
    );
    expect(screen.getByLabelText(/run-a/)).toBeInTheDocument();
    expect(screen.getByLabelText(/run-b/)).toBeInTheDocument();
  });

  it("submit is disabled until name and all labels provided", async () => {
    const u = userEvent.setup();
    render(
      wrap(
        <SaveCompareDialog open onOpenChange={() => {}} runs={runs} baselineId="r1" context="" />,
      ),
    );
    const submit = screen.getByRole("button", { name: /保存|save/i });
    expect(submit).toBeDisabled();

    await u.type(screen.getByPlaceholderText(/Qwen3|横评/i), "Study A");
    await u.type(screen.getByLabelText(/run-a/), "A");
    await u.type(screen.getByLabelText(/run-b/), "B");
    expect(submit).not.toBeDisabled();
  });
});
