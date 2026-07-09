import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TimelineItem } from "../timeline";
import { Timeline } from "./Timeline";

const noop = () => {};

function renderTimeline(timeline: TimelineItem[]) {
  return render(
    <Timeline
      timeline={timeline}
      pendingInlineTool={null}
      onSubmitToolResult={noop}
      pendingApproval={null}
      onApproveMcp={noop}
      onRejectMcp={noop}
    />,
  );
}

describe("Timeline plan strip", () => {
  it("pins a plan item as a checklist strip and does not also render it inline", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "plan",
        step: { kind: "plan", content: "1. list tenants\n2. query quota", tMs: 1000 },
      },
      {
        kind: "tool_call",
        step: { kind: "tool_call", name: "mcp__s1__list_tenants", args: {}, tMs: 2000 },
      },
    ];
    renderTimeline(timeline);
    // The plan strip is present exactly once...
    expect(screen.getByTestId("agent-plan-strip")).toBeInTheDocument();
    // ...and there is no inline `plan` step card duplicating it.
    expect(screen.queryByTestId("step-plan")).not.toBeInTheDocument();
    // The tool_call step still renders inline.
    expect(screen.getByTestId("step-tool_call")).toBeInTheDocument();
  });

  it("shows no plan strip when Plan first wasn't used", () => {
    renderTimeline([{ kind: "assistant_text", content: "done", closed: true }]);
    expect(screen.queryByTestId("agent-plan-strip")).not.toBeInTheDocument();
  });
});

describe("Timeline assistant bubbles", () => {
  it("renders assistant_text items as bubbles, not step cards", () => {
    renderTimeline([{ kind: "assistant_text", content: "Hello there", closed: true }]);
    expect(screen.getByTestId("assistant-bubble")).toBeInTheDocument();
    expect(screen.getByText("Hello there")).toBeInTheDocument();
    expect(screen.queryByTestId(/^step-/)).not.toBeInTheDocument();
  });

  it("renders a reasoning model's chain-of-thought as a collapsible block above the answer", () => {
    renderTimeline([
      {
        kind: "assistant_text",
        content: "Because of Rayleigh scattering.",
        reasoning: "The user asks why the sky is blue.",
        closed: true,
      },
    ]);
    // The answer is always visible.
    expect(screen.getByText("Because of Rayleigh scattering.")).toBeInTheDocument();
    // A completed turn's reasoning is collapsed by default — hidden until the
    // 💭 toggle is clicked.
    expect(screen.queryByText("The user asks why the sky is blue.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("💭"));
    expect(screen.getByText("The user asks why the sky is blue.")).toBeInTheDocument();
  });

  it("does not render a reasoning block when there is no reasoning", () => {
    renderTimeline([{ kind: "assistant_text", content: "plain answer", closed: true }]);
    expect(screen.getByText("plain answer")).toBeInTheDocument();
    // No 💭 reasoning toggle for a non-reasoning turn.
    expect(screen.queryByText("💭")).not.toBeInTheDocument();
  });
});
