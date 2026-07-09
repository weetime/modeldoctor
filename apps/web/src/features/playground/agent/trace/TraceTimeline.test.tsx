import type { AgentStep } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TraceTimeline } from "./TraceTimeline";

const noop = () => {};

function renderTimeline(steps: AgentStep[]) {
  return render(
    <TraceTimeline
      steps={steps}
      pendingInlineTool={null}
      onSubmitToolResult={noop}
      pendingApproval={null}
      onApproveMcp={noop}
      onRejectMcp={noop}
    />,
  );
}

describe("TraceTimeline plan strip", () => {
  it("pins a plan step as a checklist strip and does not also render it inline", () => {
    const steps: AgentStep[] = [
      { kind: "plan", content: "1. list tenants\n2. query quota", tMs: 1000 },
      { kind: "tool_call", name: "mcp__s1__list_tenants", args: {}, tMs: 2000 },
    ];
    renderTimeline(steps);
    // The plan strip is present exactly once...
    expect(screen.getByTestId("agent-plan-strip")).toBeInTheDocument();
    // ...and there is no inline `plan` step card duplicating it.
    expect(screen.queryByTestId("step-plan")).not.toBeInTheDocument();
    // The tool_call step still renders inline.
    expect(screen.getByTestId("step-tool_call")).toBeInTheDocument();
  });

  it("shows no plan strip when Plan first wasn't used", () => {
    renderTimeline([{ kind: "assistant", content: "done", tMs: 500 }]);
    expect(screen.queryByTestId("agent-plan-strip")).not.toBeInTheDocument();
  });
});
