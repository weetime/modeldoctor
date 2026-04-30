import "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlaygroundShell } from "./PlaygroundShell";

describe("PlaygroundShell", () => {
  it("renders main content and params slot side by side", () => {
    render(
      <PlaygroundShell category="chat" title="Test" paramsSlot={<div>params-here</div>}>
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
        title="Test"
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
      <PlaygroundShell category="chat" title="Test" paramsSlot={<div>panel-x</div>}>
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
        title="Test"
        paramsSlot={null}
        viewCodeSnippets={{
          curlReadable: "X",
          curlFull: "X",
          pythonReadable: "Y",
          pythonFull: "Y",
          nodeReadable: "Z",
          nodeFull: "Z",
        }}
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
      <PlaygroundShell category="chat" title="Test" paramsSlot={null} viewCodeSnippets={null}>
        <div />
      </PlaygroundShell>,
    );
    expect(screen.queryByRole("button", { name: /view code|查看代码/i })).not.toBeInTheDocument();
  });

  it("renders historySlot in the header", () => {
    render(
      <PlaygroundShell
        category="chat"
        title="Test"
        paramsSlot={null}
        historySlot={<button type="button">history-here</button>}
      >
        <div />
      </PlaygroundShell>,
    );
    expect(screen.getByText("history-here")).toBeInTheDocument();
  });
});

describe("PlaygroundShell — PageHeader + sub-toolbar (Issue #32)", () => {
  it("renders PageHeader as the first row when title is provided", () => {
    render(
      <PlaygroundShell category="chat" paramsSlot={null} title="My Title" subtitle="An intro">
        <div>main</div>
      </PlaygroundShell>,
    );
    expect(screen.getByRole("heading", { name: "My Title" })).toBeInTheDocument();
    expect(screen.getByText("An intro")).toBeInTheDocument();
  });

  it("does NOT render the sub-toolbar when paramsSlot is null and no slots are provided", () => {
    const { container } = render(
      <PlaygroundShell category="chat" paramsSlot={null} title="X">
        <div>main</div>
      </PlaygroundShell>,
    );
    // PageHeader's <header> is still present; assert there is exactly ONE <header>.
    expect(container.querySelectorAll("header")).toHaveLength(1);
  });

  it("renders the sub-toolbar when paramsSlot is non-null (collapse button needs to be reachable)", () => {
    const { container } = render(
      <PlaygroundShell category="chat" paramsSlot={<div>p</div>} title="X">
        <div>main</div>
      </PlaygroundShell>,
    );
    // Two <header>s: PageHeader + sub-toolbar.
    expect(container.querySelectorAll("header")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /collapse|折叠/i })).toBeInTheDocument();
  });

  it("renders the sub-toolbar when only tabs are provided (no params panel)", () => {
    const { container } = render(
      <PlaygroundShell
        category="chat"
        paramsSlot={null}
        title="X"
        tabs={[
          { key: "a", label: "A" },
          { key: "b", label: "B" },
        ]}
        activeTab="a"
        onTabChange={() => {}}
      >
        <div>main</div>
      </PlaygroundShell>,
    );
    expect(container.querySelectorAll("header")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "A" })).toBeInTheDocument();
    // Collapse button is suppressed when paramsSlot is null.
    expect(screen.queryByRole("button", { name: /collapse|折叠/i })).not.toBeInTheDocument();
  });

  it("renders toolbarRightSlot in the sub-toolbar", () => {
    render(
      <PlaygroundShell
        category="chat"
        paramsSlot={null}
        title="X"
        toolbarRightSlot={<button type="button">extra-btn</button>}
      >
        <div>main</div>
      </PlaygroundShell>,
    );
    expect(screen.getByText("extra-btn")).toBeInTheDocument();
  });
});
