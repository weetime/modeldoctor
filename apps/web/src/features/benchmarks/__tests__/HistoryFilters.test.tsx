import type { ListBenchmarksQuery } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

// The connection filter calls useConnections(); stub it so these tests don't
// need a QueryClient / api-client mock.
vi.mock("@/features/connections/queries", () => ({
  useConnections: () => ({
    data: [
      { id: "conn-1", name: "vLLM Local", model: "Qwen2.5-0.5B", baseUrl: "http://x" },
      { id: "conn-2", name: "vLLM Remote", model: "Qwen3-8B", baseUrl: "http://y" },
    ],
  }),
}));

import { BenchmarkListFilters } from "../BenchmarkListFilters";

describe("BenchmarkListFilters baseline dropdown", () => {
  it("emits isBaseline=true when 'Is a baseline' is selected", async () => {
    const onChange = vi.fn();
    const query: Partial<ListBenchmarksQuery> = {};
    render(<BenchmarkListFilters query={query} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: /Baseline|基线/ }));
    await user.click(screen.getByRole("option", { name: /Is a baseline|是基线/ }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ isBaseline: true, referencesBaseline: undefined }),
    );
  });

  it("emits referencesBaseline=true when 'References a baseline' is selected", async () => {
    const onChange = vi.fn();
    const query: Partial<ListBenchmarksQuery> = {};
    render(<BenchmarkListFilters query={query} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: /Baseline|基线/ }));
    await user.click(screen.getByRole("option", { name: /References a baseline|对比某个基线/ }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ referencesBaseline: true, isBaseline: undefined }),
    );
  });

  it("emits both undefined when 'Any' is selected", async () => {
    const onChange = vi.fn();
    const query: Partial<ListBenchmarksQuery> = { isBaseline: true };
    render(<BenchmarkListFilters query={query} onChange={onChange} />);
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

describe("BenchmarkListFilters connection dropdown", () => {
  it("emits connectionId when a connection is picked", async () => {
    const onChange = vi.fn();
    render(<BenchmarkListFilters query={{}} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: /Connection|连接/ }));
    // Options render model name as the prominent label.
    await user.click(screen.getByRole("option", { name: /Qwen3-8B/ }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ connectionId: "conn-2" }));
  });

  it("clears connectionId when 'Any' is picked", async () => {
    const onChange = vi.fn();
    render(<BenchmarkListFilters query={{ connectionId: "conn-1" }} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: /Connection|连接/ }));
    const anyOptions = screen.getAllByRole("option", { name: /^Any|^全部$/ });
    await user.click(anyOptions[anyOptions.length - 1]);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ connectionId: undefined }));
  });
});
