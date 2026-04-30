import "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { HistoryDrawer } from "./HistoryDrawer";
import { createHistoryStore } from "./createHistoryStore";

interface Snap {
  text: string;
}

const useStore = createHistoryStore<Snap>({
  name: "md-history-drawer-test",
  blank: () => ({ text: "" }),
  preview: (s) => s.text,
});

describe("HistoryDrawer", () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.getState().reset();
  });

  it("renders 'New session' button and empty list when only current exists", async () => {
    const user = userEvent.setup();
    render(<HistoryDrawer useHistoryStore={useStore} />);
    // Open the dropdown first
    await user.click(screen.getByRole("button", { name: /history|历史/i }));
    expect(await screen.findByText(/new session|新会话/i)).toBeInTheDocument();
    expect(screen.getByText(/no history|暂无历史/i)).toBeInTheDocument();
  });

  it("New session calls newSession on click", async () => {
    const user = userEvent.setup();
    render(<HistoryDrawer useHistoryStore={useStore} />);
    await user.click(screen.getByRole("button", { name: /history|历史/i }));
    await user.click(await screen.findByText(/new session|新会话/i));
    expect(useStore.getState().list).toHaveLength(2);
  });

  it("clicking an old entry opens AlertDialog; confirm restores into top", async () => {
    useStore.getState().save({ text: "first" });
    useStore.getState().newSession();
    useStore.getState().save({ text: "second" });
    const user = userEvent.setup();
    render(<HistoryDrawer useHistoryStore={useStore} />);
    await user.click(screen.getByRole("button", { name: /history|历史/i }));
    await user.click(await screen.findByText("first"));
    // AlertDialog appears with Restore + Cancel
    const restoreBtn = await screen.findByRole("button", { name: /^restore$|^恢复$/i });
    await user.click(restoreBtn);
    expect(useStore.getState().list[0].snapshot.text).toBe("first");
  });

  it("clicking an old entry's trash icon removes the entry without restoring", async () => {
    useStore.getState().save({ text: "first" });
    useStore.getState().newSession();
    useStore.getState().save({ text: "second" });
    const user = userEvent.setup();
    render(<HistoryDrawer useHistoryStore={useStore} />);
    await user.click(screen.getByRole("button", { name: /history|历史/i }));
    const delBtn = await screen.findByRole("button", { name: /delete this entry|删除这条记录/i });
    await user.click(delBtn);
    // Old entry gone, current intact
    expect(useStore.getState().list).toHaveLength(1);
    expect(useStore.getState().list[0].snapshot.text).toBe("second");
  });

  it("renderRowExtras is called for each non-current entry and its output appears in the row", async () => {
    useStore.getState().save({ text: "alpha" });
    useStore.getState().newSession();
    useStore.getState().save({ text: "beta" });
    const user = userEvent.setup();
    render(
      <HistoryDrawer
        useHistoryStore={useStore}
        renderRowExtras={(e) => <span data-testid={`extra-${e.snapshot.text}`}>extra</span>}
      />,
    );
    await user.click(screen.getByRole("button", { name: /history|历史/i }));
    // "alpha" is the older entry
    expect(await screen.findByTestId("extra-alpha")).toBeInTheDocument();
    // "beta" is the current entry — should NOT appear
    expect(screen.queryByTestId("extra-beta")).not.toBeInTheDocument();
  });
});
