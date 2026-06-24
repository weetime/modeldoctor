import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { AddBenchmarkButton } from "../AddBenchmarkButton";

const useBenchmarkListMock = vi.fn();
vi.mock("@/features/benchmarks/queries", () => ({
  useBenchmarkList: (q: unknown) => useBenchmarkListMock(q),
}));

function page(items: { id: string; name: string }[]) {
  return { data: { pages: [{ items, nextCursor: null }] }, isLoading: false };
}

describe("<AddBenchmarkButton>", () => {
  beforeEach(() => useBenchmarkListMock.mockReset());

  it("queries completed runs scoped to scenario + tool", () => {
    useBenchmarkListMock.mockReturnValue(page([]));
    render(
      <AddBenchmarkButton scenario="lb-strategy" tool="aiperf" existingIds={[]} onAdd={() => {}} />,
    );
    expect(useBenchmarkListMock).toHaveBeenCalledWith(
      expect.objectContaining({ scenario: "lb-strategy", tool: "aiperf", status: "completed" }),
    );
  });

  it("lists candidates excluding already-selected ids and calls onAdd on click", async () => {
    useBenchmarkListMock.mockReturnValue(
      page([
        { id: "a", name: "run-A" },
        { id: "b", name: "run-B" },
        { id: "c", name: "run-C" },
      ]),
    );
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(
      <AddBenchmarkButton scenario="lb-strategy" tool="aiperf" existingIds={["b"]} onAdd={onAdd} />,
    );
    await user.click(screen.getByRole("button", { name: /Add benchmark|添加/i }));
    // run-B is already selected → excluded; run-A / run-C are offered.
    await waitFor(() => expect(screen.getByText("run-A")).toBeInTheDocument());
    expect(screen.queryByText("run-B")).not.toBeInTheDocument();
    await user.click(screen.getByText("run-C"));
    expect(onAdd).toHaveBeenCalledWith("c");
  });
});
