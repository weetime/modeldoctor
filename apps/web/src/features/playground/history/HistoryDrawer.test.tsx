import "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

  it("clicking an old entry confirms then restores", async () => {
    useStore.getState().save({ text: "first" });
    useStore.getState().newSession();
    useStore.getState().save({ text: "second" });
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<HistoryDrawer useHistoryStore={useStore} />);
    await user.click(screen.getByRole("button", { name: /history|历史/i }));
    await user.click(await screen.findByText("first"));
    expect(confirmSpy).toHaveBeenCalled();
    expect(useStore.getState().list[0].snapshot.text).toBe("first");
    confirmSpy.mockRestore();
  });
});
