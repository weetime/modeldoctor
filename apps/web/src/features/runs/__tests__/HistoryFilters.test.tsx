import type { ListRunsQuery } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { RunListFilters } from "../RunListFilters";

describe("RunListFilters baseline dropdown", () => {
  it("emits isBaseline=true when 'Is a baseline' is selected", async () => {
    const onChange = vi.fn();
    const query: Partial<ListRunsQuery> = {};
    render(<RunListFilters query={query} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: /Baseline|基线/ }));
    await user.click(screen.getByRole("option", { name: /Is a baseline|是基线/ }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ isBaseline: true, referencesBaseline: undefined }),
    );
  });

  it("emits referencesBaseline=true when 'References a baseline' is selected", async () => {
    const onChange = vi.fn();
    const query: Partial<ListRunsQuery> = {};
    render(<RunListFilters query={query} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: /Baseline|基线/ }));
    await user.click(screen.getByRole("option", { name: /References a baseline|对比某个基线/ }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ referencesBaseline: true, isBaseline: undefined }),
    );
  });

  it("emits both undefined when 'Any' is selected", async () => {
    const onChange = vi.fn();
    const query: Partial<ListRunsQuery> = { isBaseline: true };
    render(<RunListFilters query={query} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: /Baseline|基线/ }));
    // The first option in the baseline select is "Any". There may be other
    // "Any" options in other selects; the LAST match (lowest in the page) is
    // the one inside the just-opened Baseline popover.
    const anyOptions = screen.getAllByRole("option", { name: /^Any|^全部$/ });
    await user.click(anyOptions[anyOptions.length - 1]);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ isBaseline: undefined, referencesBaseline: undefined }),
    );
  });
});
