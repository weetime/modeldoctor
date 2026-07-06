import type { Benchmark } from "@modeldoctor/contracts";
import type { Tau2Report } from "@modeldoctor/tool-adapters/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { ApiError, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});

import { api } from "@/lib/api-client";
import { AgentReport } from "../AgentReport";
import type { Tau2Results } from "../agent/queries";

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

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("AgentReport", () => {
  beforeAll(async () => {
    // Report copy is zh-CN by convention; pin explicitly rather than relying
    // on i18next's fallbackLng (en-US) since a couple of assertions below
    // check zh-only conclusion copy.
    await i18n.changeLanguage("zh-CN");
  });

  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("renders overall, per-domain bars, gate badge and user-sim label", () => {
    render(<AgentReport benchmark={agentBenchmarkFixture} />, { wrapper: Wrapper });

    // "40%" now also appears in the attribution table (user_error share) —
    // assert presence rather than uniqueness.
    expect(screen.getAllByText(/40%/).length).toBeGreaterThan(0); // overall pass^1
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
    render(<AgentReport benchmark={bm} />, { wrapper: Wrapper });
    expect(screen.getByText(/Report shape not recognized/i)).toBeInTheDocument();
  });

  it("fills the attribution slot with FailureAttribution and doesn't crash the replay slot when both highlights are null", () => {
    render(<AgentReport benchmark={agentBenchmarkFixture} />, { wrapper: Wrapper });

    const attributionSlot = screen.getByTestId("agent-report-attribution-slot");
    // agent_error: 12/20 = 60%, the larger of the two buckets. "60%" shows
    // up both in the table row and the one-line conclusion.
    expect(within(attributionSlot).getAllByText(/60%/).length).toBeGreaterThan(0);
    expect(within(attributionSlot).getByText(/最主要/)).toBeInTheDocument();

    // Both highlight ids are null in this fixture — the replay slot must not
    // crash, and must not mount either ConversationReplay heading.
    const replaySlot = screen.getByTestId("agent-report-replay-slot");
    expect(within(replaySlot).queryByText(/高光对话|Highlight conversation/)).toBeNull();
    expect(within(replaySlot).queryByText(/翻车对话|Failure conversation/)).toBeNull();
  });

  it("mounts ConversationReplay for a non-null success highlight while leaving the null failure highlight unmounted", async () => {
    const results: Tau2Results = {
      simulations: [
        {
          id: "s1",
          task_id: "task-1",
          trial: 0,
          reward_info: { reward: 1, action_checks: [] },
          messages: [{ role: "user", content: "订一张明天的机票" }],
        },
      ],
    };
    vi.mocked(api.get).mockResolvedValueOnce(results);

    const bm = {
      ...agentBenchmarkFixture,
      summaryMetrics: {
        tool: "tau2",
        data: {
          ...tau2Report,
          highlights: {
            successSimId: "s1",
            successDomain: "airline",
            failureSimId: null,
            failureDomain: null,
          },
        },
      },
    } as unknown as Benchmark;

    render(<AgentReport benchmark={bm} />, { wrapper: Wrapper });

    const replaySlot = screen.getByTestId("agent-report-replay-slot");
    expect(within(replaySlot).getByText(/高光对话|Highlight conversation/)).toBeInTheDocument();
    expect(within(replaySlot).queryByText(/翻车对话|Failure conversation/)).toBeNull();
    expect(await within(replaySlot).findByText(/订一张明天的机票/)).toBeInTheDocument();
  });
});
