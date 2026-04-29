import "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlaygroundShell } from "./PlaygroundShell";

describe("PlaygroundShell", () => {
  it("renders main content and params slot side by side", () => {
    render(
      <PlaygroundShell category="chat" paramsSlot={<div>params-here</div>}>
        <div>main-here</div>
      </PlaygroundShell>,
    );
    expect(screen.getByText("main-here")).toBeInTheDocument();
    expect(screen.getByText("params-here")).toBeInTheDocument();
  });

  it("renders tabs and calls onTabChange when clicked", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(
      <PlaygroundShell
        category="chat"
        tabs={[
          { key: "single", label: "Single" },
          { key: "compare", label: "Compare" },
        ]}
        activeTab="single"
        onTabChange={onTabChange}
        paramsSlot={null}
      >
        <div />
      </PlaygroundShell>,
    );
    await user.click(screen.getByRole("button", { name: "Compare" }));
    expect(onTabChange).toHaveBeenCalledWith("compare");
  });

  it("collapse button hides the params panel", async () => {
    const user = userEvent.setup();
    render(
      <PlaygroundShell category="chat" paramsSlot={<div>panel-x</div>}>
        <div />
      </PlaygroundShell>,
    );
    expect(screen.getByText("panel-x")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /collapse|折叠/i }));
    expect(screen.queryByText("panel-x")).not.toBeInTheDocument();
  });

  it("renders the View Code button when viewCodeSnippets is provided", async () => {
    const user = userEvent.setup();
    render(
      <PlaygroundShell
        category="chat"
        paramsSlot={null}
        viewCodeSnippets={{ curl: "X", python: "Y", node: "Z" }}
      >
        <div />
      </PlaygroundShell>,
    );
    const btn = screen.getByRole("button", { name: /view code|查看代码/i });
    expect(btn).toBeInTheDocument();
    await user.click(btn);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("X")).toBeInTheDocument();
  });

  it("does not render the View Code button when viewCodeSnippets is null", () => {
    render(
      <PlaygroundShell category="chat" paramsSlot={null} viewCodeSnippets={null}>
        <div />
      </PlaygroundShell>,
    );
    expect(screen.queryByRole("button", { name: /view code|查看代码/i })).not.toBeInTheDocument();
  });

  it("renders historySlot in the header", () => {
    render(
      <PlaygroundShell
        category="chat"
        paramsSlot={null}
        historySlot={<button type="button">history-here</button>}
      >
        <div />
      </PlaygroundShell>,
    );
    expect(screen.getByText("history-here")).toBeInTheDocument();
  });
});
