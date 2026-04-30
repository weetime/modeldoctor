import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PromptComposer } from "./PromptComposer";

describe("PromptComposer", () => {
  it("calls onChange as the user types", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <PromptComposer
        value=""
        onChange={onChange}
        onSubmit={() => {}}
        sendLabel="Send"
        placeholder="Type"
      />,
    );
    await user.type(screen.getByPlaceholderText("Type"), "hi");
    // userEvent.type triggers onChange per keystroke
    expect(onChange).toHaveBeenCalled();
  });

  it("Enter submits, Shift+Enter does not", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <PromptComposer
        value="hello"
        onChange={() => {}}
        onSubmit={onSubmit}
        sendLabel="Send"
        placeholder="Type"
      />,
    );
    const ta = screen.getByPlaceholderText("Type");
    ta.focus();
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("disables send when sendDisabled is true and Enter is a no-op", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <PromptComposer
        value="x"
        onChange={() => {}}
        onSubmit={onSubmit}
        sendLabel="Send"
        sendDisabled
        placeholder="Type"
      />,
    );
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    screen.getByPlaceholderText("Type").focus();
    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders the toolbar slot above the Send button", () => {
    render(
      <PromptComposer
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        sendLabel="Send"
        toolbar={<button type="button">Tool</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Tool" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });
});
