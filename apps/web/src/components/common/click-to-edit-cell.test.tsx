import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClickToEditCell } from "./click-to-edit-cell";

describe("ClickToEditCell", () => {
  it("commits a changed value on Enter", () => {
    const onCommit = vi.fn();
    render(<ClickToEditCell value="OFF" onCommit={onCommit} ariaLabel="Edit label" />);
    fireEvent.click(screen.getByTitle("Edit label"));
    const input = screen.getByLabelText("Edit label");
    fireEvent.change(input, { target: { value: "ON" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("ON");
  });

  it("cancels on Escape and does not commit", () => {
    const onCommit = vi.fn();
    render(<ClickToEditCell value="OFF" onCommit={onCommit} ariaLabel="Edit label" />);
    fireEvent.click(screen.getByTitle("Edit label"));
    const input = screen.getByLabelText("Edit label");
    fireEvent.change(input, { target: { value: "ON" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not commit an unchanged value", () => {
    const onCommit = vi.fn();
    render(<ClickToEditCell value="OFF" onCommit={onCommit} ariaLabel="Edit label" />);
    fireEvent.click(screen.getByTitle("Edit label"));
    fireEvent.keyDown(screen.getByLabelText("Edit label"), { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("shows the placeholder when value is empty", () => {
    render(<ClickToEditCell value="" onCommit={vi.fn()} ariaLabel="Edit label" placeholder="—" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
