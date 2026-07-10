import type { AgentStep } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { formatElapsed, parseToolLabel, StepCard } from "./StepCard";

describe("parseToolLabel", () => {
  it("strips the mcp__<serverId>__ prefix", () => {
    expect(parseToolLabel("mcp__cmr123__list_tenants")).toEqual({
      serverId: "cmr123",
      toolName: "list_tenants",
    });
  });
  it("passes plain (builtin/inline) names through", () => {
    expect(parseToolLabel("calculator")).toEqual({ toolName: "calculator" });
  });
});

describe("formatElapsed", () => {
  it("shows seconds at/above 1s and ms below", () => {
    expect(formatElapsed(13286)).toBe("13.3s");
    expect(formatElapsed(840)).toBe("840ms");
  });
});

describe("StepCard", () => {
  it("renders a clean MCP tool name with the server badge, not the raw prefix", () => {
    const step: AgentStep = {
      kind: "tool_call",
      name: "mcp__srv1__list_tenants",
      args: {},
      tMs: 1200,
    };
    render(<StepCard step={step} index={1} mcpServerNames={{ srv1: "camp-mcp-server" }} />);
    expect(screen.getByText("list_tenants")).toBeInTheDocument();
    expect(screen.getByText("camp-mcp-server")).toBeInTheDocument();
    expect(screen.queryByText(/mcp__srv1__/)).not.toBeInTheDocument();
    expect(screen.getByText("1.2s")).toBeInTheDocument();
  });

  it("collapses a tool result by default and expands the pretty JSON on click", async () => {
    const step: AgentStep = {
      kind: "tool_result",
      name: "mcp__srv1__list_tenants",
      content: JSON.stringify([{ name: "ai-for-deployer" }, { name: "gen-studio" }]),
      tMs: 2000,
    };
    render(<StepCard step={step} index={2} />);
    // Collapsed: shows an array summary, hides the full body.
    expect(screen.getByText("[] · 2")).toBeInTheDocument();
    expect(screen.queryByText(/ai-for-deployer/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("[] · 2"));
    expect(screen.getByText(/ai-for-deployer/)).toBeInTheDocument();
  });

  it("renders assistant markdown (bold, not literal asterisks)", () => {
    const step: AgentStep = { kind: "assistant", content: "There are **3 tenants**", tMs: 100 };
    render(<StepCard step={step} index={3} />);
    const strong = screen.getByText("3 tenants");
    expect(strong.tagName).toBe("STRONG");
  });
});
