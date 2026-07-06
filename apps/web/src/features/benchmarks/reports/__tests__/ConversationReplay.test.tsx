import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import type { Tau2Results } from "../agent/queries";

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
import { ConversationReplay } from "../agent/ConversationReplay";

const sampleResults: Tau2Results = {
  simulations: [
    {
      id: "s1",
      task_id: "task-1",
      trial: 0,
      termination_reason: "user_stop",
      reward_info: { reward: 1, action_checks: [] },
      messages: [
        { role: "user", content: "我想查询航班状态" },
        { role: "assistant", content: "好的，正在查询" },
      ],
    },
    {
      id: "s2",
      task_id: "task-2",
      trial: 0,
      termination_reason: "agent_stop",
      reward_info: {
        reward: 0,
        action_checks: [
          {
            action_match: false,
            tool_type: "write",
            action: { name: "book_reservation" },
          },
        ],
      },
      messages: [
        { role: "user", content: "帮我把航班改签到明天" },
        {
          role: "assistant",
          content: "好的，马上处理",
          tool_calls: [{ id: "call-1", name: "book_reservation", arguments: { date: "tomorrow" } }],
        },
      ],
    },
  ],
};

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("ConversationReplay", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("renders chat bubbles for the highlighted failure sim and marks the faulty turn", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(sampleResults);
    render(
      <ConversationReplay benchmarkId="b1" simId="s2" domain="airline" variant="failure" />,
      { wrapper: Wrapper },
    );

    expect(await screen.findByText(/改签/)).toBeInTheDocument();
    expect(screen.getByText(/book_reservation/)).toBeInTheDocument();
    expect(screen.getByTestId("faulty-turn")).toBeInTheDocument();
  });
});
