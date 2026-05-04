import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

import { CompareToolbar } from "../CompareToolbar";

describe("CompareToolbar", () => {
  const runs = [
    { id: "a", name: "run-A", tool: "guidellm" },
    { id: "b", name: "run-B", tool: "guidellm" },
  ];

  it("renders baseline dropdown with None + each run option", () => {
    render(<CompareToolbar runs={runs} baselineId={null} onBaselineChange={() => undefined} />);
    // None entry + each run name
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText(/None|无/i)).toBeInTheDocument();
    expect(screen.getByText("run-A")).toBeInTheDocument();
    expect(screen.getByText("run-B")).toBeInTheDocument();
  });

  it("invokes onBaselineChange when user selects a run", async () => {
    const onBaselineChange = vi.fn();
    render(<CompareToolbar runs={runs} baselineId={null} onBaselineChange={onBaselineChange} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    await userEvent.selectOptions(select, "a");
    expect(onBaselineChange).toHaveBeenCalledWith("a");
  });

  it("invokes onBaselineChange with null when user picks None", async () => {
    const onBaselineChange = vi.fn();
    render(<CompareToolbar runs={runs} baselineId="a" onBaselineChange={onBaselineChange} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    await userEvent.selectOptions(select, "");
    expect(onBaselineChange).toHaveBeenCalledWith(null);
  });
});
