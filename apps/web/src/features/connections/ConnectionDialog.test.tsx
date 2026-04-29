import "@/lib/i18n";
import { useConnectionsStore } from "@/stores/connections-store";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ConnectionDialog } from "./ConnectionDialog";

async function fillBaseFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^name$/i), "n1");
  await user.type(screen.getByLabelText(/api base url/i), "http://x.test");
  await user.type(screen.getByLabelText(/api key/i), "sk-1");
  await user.type(screen.getByLabelText(/^model$/i), "m1");
}

describe("ConnectionDialog (category + tags)", () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionsStore.setState({ connections: [] });
  });

  it("requires a category before save", async () => {
    const user = userEvent.setup();
    render(<ConnectionDialog open onOpenChange={() => {}} />);
    await fillBaseFields(user);
    await user.click(screen.getByRole("button", { name: /save|保存/i }));

    // The dialog should still be open because category is required.
    expect(screen.getAllByText(/category|分类/i).length).toBeGreaterThan(0);
    expect(useConnectionsStore.getState().list()).toHaveLength(0);
  });

  it("creates a connection with selected category and entered tags", async () => {
    const user = userEvent.setup();
    render(<ConnectionDialog open onOpenChange={() => {}} />);
    await fillBaseFields(user);

    // Open category dropdown and pick "Chat"
    await user.click(screen.getByRole("combobox", { name: /category|分类/i }));
    await user.click(screen.getByRole("option", { name: /^chat$|^对话$/i }));

    // Add two tags
    const tagInput = screen.getByLabelText(/^tags$/i);
    await user.type(tagInput, "vLLM{Enter}");
    await user.type(tagInput, "production{Enter}");

    await user.click(screen.getByRole("button", { name: /save|保存/i }));

    await waitFor(() => {
      const list = useConnectionsStore.getState().list();
      expect(list).toHaveLength(1);
      expect(list[0].category).toBe("chat");
      expect(list[0].tags).toEqual(["vLLM", "production"]);
    });
  });

  it("removing a chip drops the tag", async () => {
    const user = userEvent.setup();
    render(<ConnectionDialog open onOpenChange={() => {}} />);
    const tagInput = screen.getByLabelText(/^tags$/i);
    await user.type(tagInput, "x{Enter}");
    await user.type(tagInput, "y{Enter}");

    await user.click(screen.getByRole("button", { name: /remove tag x|移除标签 x/i }));

    expect(screen.queryByText("x")).not.toBeInTheDocument();
    expect(screen.getByText("y")).toBeInTheDocument();
  });
});
