import type { Benchmark } from "@modeldoctor/contracts";
import type { Tau2Report } from "@modeldoctor/tool-adapters/schemas";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import { AgentReport } from "../AgentReport";

const tau2Report: Tau2Report = {
  kind: "agent-tau2",
  userSimModel: "deepseek-v3",
  numTrials: 3,
  overall: { pass1: 0.4, passK: 0.6, tasks: 60 },
  perDomain: {
    airline: { pass1: 0.3, passK: 0.5, tasks: 20 },
    retail: { pass1: 0.5, passK: 0.7, tasks: 20 },
    telecom: { pass1: 0.4, passK: 0.6, tasks: 20 },
  },
  attribution: { agent_error: 12, user_error: 8 },
  highlights: {
    successSimId: null,
    successDomain: null,
    failureSimId: null,
    failureDomain: null,
  },
  gate: { mode: "perDomainFloor", result: "FAILED", detail: "airline pass^1<0.5" },
};

const agentBenchmarkFixture = {
  id: "b1",
  name: "Agent · tau2-bench",
  tool: "tau2",
  scenario: "agent",
  status: "completed",
  summaryMetrics: { tool: "tau2", data: tau2Report },
} as unknown as Benchmark;

describe("AgentReport", () => {
  it("renders overall, per-domain bars, gate badge and user-sim label", () => {
    render(<AgentReport benchmark={agentBenchmarkFixture} />);

    expect(screen.getByText(/40%/)).toBeInTheDocument(); // overall pass^1
    expect(screen.getByText("airline")).toBeInTheDocument();
    expect(screen.getByText("retail")).toBeInTheDocument();
    expect(screen.getByText("telecom")).toBeInTheDocument();
    expect(screen.getByText(/deepseek-v3/)).toBeInTheDocument(); // 模拟用户模型标注
    expect(screen.getByText(/FAILED|PASSED|WARNING/)).toBeInTheDocument();
  });

  it("falls back to UnknownReport when summaryMetrics does not parse as a Tau2Report", () => {
    const bm = {
      ...agentBenchmarkFixture,
      summaryMetrics: { tool: "tau2", data: { kind: "not-a-tau2-report" } },
    } as unknown as Benchmark;
    render(<AgentReport benchmark={bm} />);
    expect(screen.getByText(/Report shape not recognized/i)).toBeInTheDocument();
  });
});
