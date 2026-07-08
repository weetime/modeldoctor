import "@/lib/i18n";
import type {
  AgentSseEvent,
  ChatMessage,
  ConnectionPublic,
  SkillPublic,
} from "@modeldoctor/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SAMPLE_CONN: ConnectionPublic = {
  id: "c1",
  userId: "u1",
  name: "chat-1",
  baseUrl: "http://x",
  apiKeyPreview: "sk-...1234",
  enabled: true,
  model: "m",
  customHeaders: "",
  queryParams: "",
  category: "chat",
  tags: [],
  createdAt: "2026-04-26T14:22:00Z",
  updatedAt: "2026-04-26T14:22:00Z",
  prometheusDatasourceId: null,
  prometheusDatasource: null,
  serverKind: null,
  tokenizerHfId: null,
  evaluationProfileId: null,
  evaluationProfile: null,
};

vi.mock("@/features/connections/queries", () => ({
  useConnections: () => ({ data: [SAMPLE_CONN], isLoading: false, error: null }),
}));

vi.mock("@/features/mcp-servers/queries", () => ({
  useMcpServers: () => ({ data: [], isLoading: false }),
}));

const SAMPLE_SKILL: SkillPublic = {
  id: "skill1",
  userId: "u1",
  name: "diagnose-vllm",
  description: "Diagnose a vLLM deployment",
  systemPrompt: "You are an SRE assistant.",
  modelConnectionId: "c1",
  mcpServerIds: ["mcp1"],
  inlineTools: [
    { type: "function", function: { name: "lookup_order", parameters: { type: "object" } } },
  ],
  planFirst: true,
  maxSteps: 30,
  createdAt: "2026-07-05T00:00:00Z",
  updatedAt: "2026-07-05T00:00:00Z",
};

// Mutable so individual tests can opt into a non-empty skill list.
let skillsListData: SkillPublic[] = [];
const createSkillMutateAsync = vi.fn();

vi.mock("@/features/skills/queries", () => ({
  useSkills: () => ({ data: skillsListData, isLoading: false }),
  useCreateSkill: () => ({ mutateAsync: createSkillMutateAsync, isPending: false }),
}));

// The scripted SSE sequence this fake plays back for every run: plan →
// tool_call → tool_result → assistant → done. Each event is JSON.stringify()d
// before being handed to onSseEvent, mirroring the real wire format (a
// `data: <json>` SSE line, minus the `data:` prefix which the real
// playgroundFetchStream strips before calling this callback).
const SCRIPTED_EVENTS: AgentSseEvent[] = [
  { type: "step", step: { kind: "plan", content: "1. compute 1+1", tMs: 5 } },
  {
    type: "step",
    step: {
      kind: "tool_call",
      name: "calculator",
      args: { expression: "1+1" },
      toolCallId: "call1",
      tMs: 10,
    },
  },
  {
    type: "step",
    step: { kind: "tool_result", name: "calculator", content: "2", toolCallId: "call1", tMs: 15 },
  },
  { type: "step", step: { kind: "assistant", content: "The answer is 2.", tMs: 20 } },
  { type: "done" },
];

interface FakeStreamInput {
  path: string;
  body: { messages?: unknown; autoRunMcp?: boolean };
  signal: AbortSignal;
  onSseEvent: (data: string) => void;
}

const playgroundFetchStreamMock = vi.fn(async ({ onSseEvent }: FakeStreamInput) => {
  for (const evt of SCRIPTED_EVENTS) onSseEvent(JSON.stringify(evt));
});

vi.mock("@/lib/playground-stream", () => ({
  playgroundFetchStream: (input: FakeStreamInput) => playgroundFetchStreamMock(input),
}));

import { AgentPage } from "./AgentPage";
import { useAgentStore } from "./store";

describe("AgentPage", () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
    playgroundFetchStreamMock.mockClear();
    skillsListData = [];
    createSkillMutateAsync.mockClear();
    createSkillMutateAsync.mockResolvedValue(SAMPLE_SKILL);
  });

  it("renders the 4 scripted step cards in order and running=false after done", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AgentPage />
      </MemoryRouter>,
    );

    // Pick the connection (first combobox — the endpoint picker, not the Skill dropdown).
    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(screen.getByRole("option", { name: /chat-1/i }));

    // Fill in the task.
    const taskBox = screen.getAllByRole("textbox")[0];
    await user.type(taskBox, "what is 1+1?");

    // Run.
    await user.click(screen.getByRole("button", { name: /run|运行/i }));

    await waitFor(() => {
      expect(screen.getByTestId("step-plan")).toBeInTheDocument();
      expect(screen.getByTestId("step-tool_call")).toBeInTheDocument();
      expect(screen.getByTestId("step-tool_result")).toBeInTheDocument();
      expect(screen.getByTestId("step-assistant")).toBeInTheDocument();
    });

    // Assert render order matches the scripted sequence.
    const cards = screen.getAllByTestId(/^step-/);
    expect(cards.map((c) => c.getAttribute("data-testid"))).toEqual([
      "step-plan",
      "step-tool_call",
      "step-tool_result",
      "step-assistant",
    ]);

    // running flips false after "done" — Run button is back, Stop is gone.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /run|运行/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /stop|停止/i })).not.toBeInTheDocument();
    });

    expect(useAgentStore.getState().steps).toHaveLength(4);
    expect(useAgentStore.getState().running).toBe(false);
  });

  // Full-transcript continuation (Task 11 fix pass): the server's `done`
  // event carries the full transcript so far when pausing — the frontend
  // stashes it (`continuationMessages`) and resends it verbatim on
  // submit/approve, instead of rebuilding a minimal 3-message transcript.
  const PAUSED_INLINE_TOOL_TRANSCRIPT: ChatMessage[] = [
    { role: "user", content: "call my inline tool" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call2",
          type: "function",
          function: { name: "my_inline_tool", arguments: JSON.stringify({ foo: "bar" }) },
        },
      ],
    },
  ];

  it("renders a pending inline-tool card with a submit-result affordance", async () => {
    playgroundFetchStreamMock.mockImplementationOnce(
      async ({ onSseEvent }: { onSseEvent: (data: string) => void }) => {
        onSseEvent(
          JSON.stringify({
            type: "tool_result_needed",
            toolCallId: "call2",
            name: "my_inline_tool",
            args: { foo: "bar" },
          } satisfies AgentSseEvent),
        );
        onSseEvent(
          JSON.stringify({
            type: "done",
            messages: PAUSED_INLINE_TOOL_TRANSCRIPT,
          } satisfies AgentSseEvent),
        );
      },
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AgentPage />
      </MemoryRouter>,
    );

    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(screen.getByRole("option", { name: /chat-1/i }));
    const taskBox = screen.getAllByRole("textbox")[0];
    await user.type(taskBox, "call my inline tool");
    await user.click(screen.getByRole("button", { name: /run|运行/i }));

    await waitFor(() => {
      expect(screen.getByText(/my_inline_tool/)).toBeInTheDocument();
    });
    expect(useAgentStore.getState().pendingInlineTool).toEqual({
      toolCallId: "call2",
      name: "my_inline_tool",
      args: { foo: "bar" },
    });

    // Submitting the result triggers a continuation run — it should clear
    // the pending card and call playgroundFetchStream a second time with the
    // full `continuationMessages` transcript plus the tool result appended,
    // NOT a rebuilt minimal transcript.
    playgroundFetchStreamMock.mockClear();
    playgroundFetchStreamMock.mockImplementationOnce(async ({ onSseEvent }: FakeStreamInput) => {
      onSseEvent(JSON.stringify({ type: "done" } satisfies AgentSseEvent));
    });

    const resultBox = screen.getByPlaceholderText(/paste|结果/i);
    await user.type(resultBox, "42");
    await user.click(screen.getByRole("button", { name: /submit|提交/i }));

    await waitFor(() => {
      expect(useAgentStore.getState().pendingInlineTool).toBeNull();
    });
    expect(playgroundFetchStreamMock).toHaveBeenCalledTimes(1);
    const call = playgroundFetchStreamMock.mock.calls[0][0];
    expect(call.body.messages).toEqual([
      ...PAUSED_INLINE_TOOL_TRANSCRIPT,
      { role: "tool", tool_call_id: "call2", content: "42" },
    ]);
  });

  const PAUSED_MCP_APPROVAL_TRANSCRIPT: ChatMessage[] = [
    { role: "user", content: "search something via MCP" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call3",
          type: "function",
          function: { name: "mcp__mcp_1__search", arguments: JSON.stringify({ q: "x" }) },
        },
      ],
    },
  ];

  it("renders a pending MCP tool_approval card; 批准/Approve re-runs with autoRunMcp=true", async () => {
    playgroundFetchStreamMock.mockImplementationOnce(
      async ({ onSseEvent }: { onSseEvent: (data: string) => void }) => {
        onSseEvent(
          JSON.stringify({
            type: "step",
            step: {
              kind: "tool_call",
              name: "mcp__mcp_1__search",
              args: { q: "x" },
              toolCallId: "call3",
              tMs: 5,
            },
          } satisfies AgentSseEvent),
        );
        onSseEvent(
          JSON.stringify({
            type: "tool_approval",
            toolCallId: "call3",
            server: { id: "mcp_1", name: "higress-gw" },
            name: "mcp__mcp_1__search",
            args: { q: "x" },
          } satisfies AgentSseEvent),
        );
        onSseEvent(
          JSON.stringify({
            type: "done",
            messages: PAUSED_MCP_APPROVAL_TRANSCRIPT,
          } satisfies AgentSseEvent),
        );
      },
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AgentPage />
      </MemoryRouter>,
    );

    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(screen.getByRole("option", { name: /chat-1/i }));
    const taskBox = screen.getAllByRole("textbox")[0];
    await user.type(taskBox, "search something via MCP");
    await user.click(screen.getByRole("button", { name: /run|运行/i }));

    await waitFor(() => {
      expect(screen.getByTestId("mcp-approval-card")).toBeInTheDocument();
    });
    expect(useAgentStore.getState().pendingApproval).toEqual({
      toolCallId: "call3",
      server: { id: "mcp_1", name: "higress-gw" },
      name: "mcp__mcp_1__search",
      args: { q: "x" },
    });
    expect(useAgentStore.getState().autoRunMcp).toBe(false);

    playgroundFetchStreamMock.mockClear();
    playgroundFetchStreamMock.mockImplementationOnce(async ({ onSseEvent }: FakeStreamInput) => {
      onSseEvent(JSON.stringify({ type: "done" } satisfies AgentSseEvent));
    });

    await user.click(screen.getByRole("button", { name: /approve|批准/i }));

    await waitFor(() => {
      expect(useAgentStore.getState().pendingApproval).toBeNull();
    });
    expect(useAgentStore.getState().autoRunMcp).toBe(true);
    expect(playgroundFetchStreamMock).toHaveBeenCalledTimes(1);
    const call = playgroundFetchStreamMock.mock.calls[0][0];
    expect(call.body.autoRunMcp).toBe(true);
    // Approve resends the exact paused transcript (resume), not a fresh
    // from-scratch task — this is what lets the server skip re-running
    // whatever already executed before the pause.
    expect(call.body.messages).toEqual(PAUSED_MCP_APPROVAL_TRANSCRIPT);
    // The existing trace (the tool_call step from the paused run) is
    // appended to, not cleared/restarted, by the approve resend.
    expect(useAgentStore.getState().steps).toHaveLength(1);
    expect(useAgentStore.getState().steps[0].kind).toBe("tool_call");
  });

  it("拒绝/Reject just clears the pending approval card without re-running", async () => {
    playgroundFetchStreamMock.mockImplementationOnce(
      async ({ onSseEvent }: { onSseEvent: (data: string) => void }) => {
        onSseEvent(
          JSON.stringify({
            type: "tool_approval",
            toolCallId: "call4",
            server: { id: "mcp_1", name: "higress-gw" },
            name: "mcp__mcp_1__search",
            args: {},
          } satisfies AgentSseEvent),
        );
        onSseEvent(JSON.stringify({ type: "done" } satisfies AgentSseEvent));
      },
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AgentPage />
      </MemoryRouter>,
    );

    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(screen.getByRole("option", { name: /chat-1/i }));
    const taskBox = screen.getAllByRole("textbox")[0];
    await user.type(taskBox, "search something via MCP");
    await user.click(screen.getByRole("button", { name: /run|运行/i }));

    await waitFor(() => {
      expect(screen.getByTestId("mcp-approval-card")).toBeInTheDocument();
    });

    playgroundFetchStreamMock.mockClear();
    await user.click(screen.getByRole("button", { name: /reject|拒绝/i }));

    await waitFor(() => {
      expect(useAgentStore.getState().pendingApproval).toBeNull();
    });
    expect(playgroundFetchStreamMock).not.toHaveBeenCalled();
  });

  // Task 12: applying a Skill loads it as a preset into the store.
  it("applying a skill from the dropdown loads its config into the store", async () => {
    skillsListData = [SAMPLE_SKILL];
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AgentPage />
      </MemoryRouter>,
    );

    // Comboboxes: [0] connection picker, [1] Skill dropdown.
    const comboboxes = screen.getAllByRole("combobox");
    await user.click(comboboxes[1]);
    await user.click(screen.getByRole("option", { name: /diagnose-vllm/i }));

    await waitFor(() => {
      const s = useAgentStore.getState();
      expect(s.systemPrompt).toBe(SAMPLE_SKILL.systemPrompt);
      expect(s.planFirst).toBe(true);
      expect(s.maxSteps).toBe(30);
      expect(s.selectedMcpServerIds).toEqual(["mcp1"]);
      expect(s.inlineTools).toEqual(SAMPLE_SKILL.inlineTools);
      expect(s.selectedConnectionId).toBe("c1");
    });
  });

  // Task 12: "存为 Skill" POSTs the CURRENT store config via useCreateSkill.
  it("存为 Skill 用当前配置调用 createSkill", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AgentPage />
      </MemoryRouter>,
    );

    // Configure the current store: connection + system prompt + a max-steps tweak.
    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(screen.getByRole("option", { name: /chat-1/i }));
    const systemPromptBox = screen.getAllByRole("textbox")[1];
    await user.type(systemPromptBox, "custom prompt");

    await user.click(screen.getByRole("button", { name: /save as skill|存为 skill/i }));

    const nameInput = screen.getByLabelText(/^name|^名称/i) as HTMLInputElement;
    await user.type(nameInput, "my-skill");
    await user.click(screen.getByRole("button", { name: /^save$|^保存$/i }));

    await waitFor(() => {
      expect(createSkillMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "my-skill",
          systemPrompt: "custom prompt",
          planFirst: false,
          maxSteps: 12,
          mcpServerIds: [],
          modelConnectionId: "c1",
        }),
      );
    });
  });
});
