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

  it("renders baseline dropdown with None + each run option", async () => {
    render(<CompareToolbar runs={runs} baselineId={null} onBaselineChange={() => undefined} />);
    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeInTheDocument();
    // Closed-state trigger shows the currently-selected value: "None ..." for null
    expect(trigger.textContent ?? "").toMatch(/None|无/i);
    // Open the listbox and verify each run is listed as an option
    await userEvent.click(trigger);
    expect(await screen.findByRole("option", { name: /None|无/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "run-A" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "run-B" })).toBeInTheDocument();
  });

  it("invokes onBaselineChange when user selects a run", async () => {
    const onBaselineChange = vi.fn();
    render(<CompareToolbar runs={runs} baselineId={null} onBaselineChange={onBaselineChange} />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: "run-A" }));
    expect(onBaselineChange).toHaveBeenCalledWith("a");
  });

  it("invokes onBaselineChange with null when user picks None", async () => {
    const onBaselineChange = vi.fn();
    render(<CompareToolbar runs={runs} baselineId="a" onBaselineChange={onBaselineChange} />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: /None|无/i }));
    expect(onBaselineChange).toHaveBeenCalledWith(null);
  });
});
