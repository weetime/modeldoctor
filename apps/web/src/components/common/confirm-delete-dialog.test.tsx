import "@/lib/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";

function getKeywordInput(): HTMLInputElement {
  return screen.getByPlaceholderText("DELETE") as HTMLInputElement;
}

function getConfirmButton(): HTMLButtonElement {
  // The destructive confirm defaults to common actions.delete.
  return screen.getByRole("button", { name: /^(删除|Delete)$/ }) as HTMLButtonElement;
}

describe("<ConfirmDeleteDialog>", () => {
  it("keeps confirm disabled until DELETE is typed (case-insensitive, trimmed)", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDeleteDialog
        open
        onOpenChange={() => {}}
        title="Delete thing"
        onConfirm={onConfirm}
      />,
    );
    const confirm = getConfirmButton();
    expect(confirm).toBeDisabled();

    fireEvent.change(getKeywordInput(), { target: { value: "DEL" } });
    expect(confirm).toBeDisabled();

    fireEvent.change(getKeywordInput(), { target: { value: "  delete " } });
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not auto-close on confirm — caller owns closing", () => {
    const onOpenChange = vi.fn();
    render(
      <ConfirmDeleteDialog
        open
        onOpenChange={onOpenChange}
        title="Delete thing"
        onConfirm={() => {}}
      />,
    );
    fireEvent.change(getKeywordInput(), { target: { value: "DELETE" } });
    fireEvent.click(getConfirmButton());
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("resets typed text when reopened", () => {
    const { rerender } = render(
      <ConfirmDeleteDialog open onOpenChange={() => {}} title="T" onConfirm={() => {}} />,
    );
    fireEvent.change(getKeywordInput(), { target: { value: "DELETE" } });
    rerender(<ConfirmDeleteDialog open={false} onOpenChange={() => {}} title="T" onConfirm={() => {}} />);
    rerender(<ConfirmDeleteDialog open onOpenChange={() => {}} title="T" onConfirm={() => {}} />);
    expect(getKeywordInput().value).toBe("");
    expect(getConfirmButton()).toBeDisabled();
  });

  it("disables everything and blocks closing while pending", () => {
    const onOpenChange = vi.fn();
    render(
      <ConfirmDeleteDialog
        open
        onOpenChange={onOpenChange}
        title="T"
        pending
        confirmLabel="Delete run"
        onConfirm={() => {}}
      />,
    );
    fireEvent.change(getKeywordInput(), { target: { value: "DELETE" } });
    expect(screen.getByRole("button", { name: "Delete run" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /取消|Cancel/ })).toBeDisabled();
    // Radix calls onOpenChange(false) on Escape; the pending guard swallows it.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
