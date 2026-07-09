import "@/lib/i18n";
import type {
  AgentSseEvent,
  ChatMessage,
  ConnectionPublic,
  SkillPublic,
} from "@modeldoctor/contracts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

interface FakeStreamInput {
  path: string;
  body: {
    task?: unknown;
    builtinTools?: string[];
    mcpServerIds?: string[];
    messages?: unknown;
    autoRunMcp?: boolean;
    params?: Record<string, unknown>;
  };
  signal: AbortSignal;
  onSseEvent: (data: string) => void;
}

const playgroundFetchStreamMock = vi.fn(async ({ onSseEvent }: FakeStreamInput) => {
  onSseEvent(JSON.stringify({ type: "done" } satisfies AgentSseEvent));
});

vi.mock("@/lib/playground-stream", () => ({
  playgroundFetchStream: (input: FakeStreamInput) => playgroundFetchStreamMock(input),
}));

/** Plays back a scripted event sequence on the NEXT `playgroundFetchStream` call. */
function scriptNextRun(events: AgentSseEvent[]) {
  playgroundFetchStreamMock.mockImplementationOnce(
    async ({ onSseEvent }: { onSseEvent: (data: string) => void }) => {
      for (const evt of events) onSseEvent(JSON.stringify(evt));
    },
  );
}

import { AgentPage } from "./AgentPage";
import type { AgentHistorySnapshot } from "./history";
import { useAgentHistoryStore } from "./history";
import { useAgentStore } from "./store";

async function selectConnection(user: ReturnType<typeof userEvent.setup>) {
  // The Skill picker (composer bar, DOM-before) is always rendered now, so the
  // connection picker is the SECOND combobox (right config panel).
  const comboboxes = screen.getAllByRole("combobox");
  await user.click(comboboxes[1]);
  await user.click(screen.getByRole("option", { name: /chat-1/i }));
}

async function enableTools(user: ReturnType<typeof userEvent.setup>) {
  // There is no tools "mode" toggle anymore — a chat is armed with tools by
  // picking one. Open the always-visible "Tools" menu and tick the first
  // builtin tool, which flips `hasToolsSelected` true (agent knobs appear,
  // the run advertises tool fields), then close the popover so later queries
  // aren't ambiguous.
  await user.click(screen.getByRole("button", { name: /^tools|^工具/i }));
  const firstBuiltin = document.querySelector('[id^="agent-builtin-"]') as HTMLElement | null;
  if (!firstBuiltin) throw new Error("no builtin tool checkbox found in the Tools menu");
  await user.click(firstBuiltin);
  await user.keyboard("{Escape}");
}

async function typeTaskAndSend(user: ReturnType<typeof userEvent.setup>, text: string) {
  const draft = screen.getByPlaceholderText(/type your message|输入消息/i);
  await user.type(draft, text);
  await user.click(screen.getByRole("button", { name: /^send$|^发送$/i }));
}

/**
 * `ChatParams`'s temperature `SliderField` renders a `<Label>Temperature</Label>`
 * next to a `role="spinbutton"` number input, both inside one wrapper `<div>`
 * (the wrapper also holds the `role="slider"` thumb, which Radix doesn't
 * label via the `aria-label` passed to `<Slider>` — it lands on the Root,
 * not the Thumb — so the label text is the stable, unambiguous query here).
 */
function getTemperatureField(): { input: HTMLElement; wrapper: HTMLElement } {
  const label = screen.getByText(/^temperature$/i);
  const wrapper = label.closest("div")?.parentElement;
  if (!wrapper) throw new Error("temperature field wrapper not found");
  return { input: within(wrapper).getByRole("spinbutton"), wrapper };
}

describe("AgentPage", () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
    playgroundFetchStreamMock.mockClear();
    skillsListData = [];
    createSkillMutateAsync.mockClear();
    createSkillMutateAsync.mockResolvedValue(SAMPLE_SKILL);
  });

  describe("tools-off: unified endpoint reads as plain streaming chat", () => {
    it("renders one growing assistant bubble, no tool cards, running=false after done", async () => {
      scriptNextRun([
        { type: "text_delta", delta: "He" },
        { type: "text_delta", delta: "llo" },
        { type: "assistant_end" },
        { type: "done" },
      ]);

      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <AgentPage />
        </MemoryRouter>,
      );

      await selectConnection(user);
      await typeTaskAndSend(user, "hi");

      await waitFor(() => {
        expect(screen.getByTestId("assistant-bubble")).toBeInTheDocument();
      });
      expect(screen.getByText("Hello")).toBeInTheDocument();
      expect(screen.queryAllByTestId(/^step-/)).toHaveLength(0);
      expect(screen.queryByTestId("agent-plan-strip")).not.toBeInTheDocument();
      expect(screen.getAllByTestId("assistant-bubble")).toHaveLength(1);
      // Tools-off: no meaningless "0 tool calls" summary bar above the chat
      // bubbles — a non-empty timeline with only assistant_text items isn't
      // an agent trace.
      expect(screen.queryByTestId("run-summary")).not.toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /^send$|^发送$/i })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^stop$|^停止$/i })).not.toBeInTheDocument();
      });
      expect(useAgentStore.getState().running).toBe(false);

      // Tools-off: no builtinTools/mcpServerIds/inlineTools/planFirst/maxSteps
      // on the wire — this IS the equivalence with a plain streaming chat call.
      const call = playgroundFetchStreamMock.mock.calls[0][0] as FakeStreamInput;
      expect(call.body).not.toHaveProperty("builtinTools");
      expect(call.body).not.toHaveProperty("mcpServerIds");
      expect(call.body).not.toHaveProperty("inlineTools");
      expect(call.body).not.toHaveProperty("planFirst");
      expect(call.body).not.toHaveProperty("autoRunMcp");
      expect(call.body.task).toBe("hi");
    });
  });

  describe("tools-on: interleaved bubbles + trace cards", () => {
    it("renders plan strip, assistant bubbles, tool cards, and verdict in order", async () => {
      scriptNextRun([
        { type: "step", step: { kind: "plan", content: "1. call a tool", tMs: 1 } },
        { type: "text_delta", delta: "calling" },
        { type: "assistant_end" },
        {
          type: "step",
          step: { kind: "tool_call", name: "calculator", args: { expr: "1+1" }, tMs: 5 },
        },
        { type: "step", step: { kind: "tool_result", content: "2", tMs: 10 } },
        { type: "text_delta", delta: "the answer is 2" },
        { type: "assistant_end" },
        {
          type: "verdict",
          verdict: {
            taskCompleted: true,
            toolUseCorrect: true,
            extraSteps: 0,
            oneLineVerdict: "Solved it.",
          },
        },
        { type: "done" },
      ]);

      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <AgentPage />
        </MemoryRouter>,
      );

      await enableTools(user);
      // With tools on, the Skill picker (composer/children) now renders
      // before the connection picker (paramsSlot) in the DOM.
      const comboboxes = screen.getAllByRole("combobox");
      await user.click(comboboxes[1]);
      await user.click(screen.getByRole("option", { name: /chat-1/i }));
      await typeTaskAndSend(user, "what is 1+1?");

      await waitFor(() => {
        expect(screen.getByTestId("agent-verdict-card")).toBeInTheDocument();
      });

      expect(screen.getByTestId("agent-plan-strip")).toBeInTheDocument();
      // The plan is pinned, not also inlined as a step card.
      expect(screen.queryByTestId("step-plan")).not.toBeInTheDocument();
      // Tools-on: real tool cards in the trace, so the summary bar IS shown.
      expect(screen.getByTestId("run-summary")).toBeInTheDocument();

      const testIds = screen
        .getAllByTestId(/^(assistant-bubble|step-tool_call|step-tool_result|agent-verdict-card)$/)
        .map((el) => el.getAttribute("data-testid"));
      expect(testIds).toEqual([
        "assistant-bubble",
        "step-tool_call",
        "step-tool_result",
        "assistant-bubble",
        "agent-verdict-card",
      ]);

      const call = playgroundFetchStreamMock.mock.calls[0][0] as FakeStreamInput;
      // Tools on: builtin/mcp fields ARE present (even if empty arrays, since
      // none were picked here) — asserted via maxSteps/planFirst always present.
      expect(call.body).toHaveProperty("maxSteps");
      expect(call.body).toHaveProperty("planFirst");
    });
  });

  describe("multimodal attachments", () => {
    it("turns the task into ContentPart[] when an image is attached", async () => {
      const user = userEvent.setup();
      const { container } = render(
        <MemoryRouter>
          <AgentPage />
        </MemoryRouter>,
      );

      await selectConnection(user);

      const imageInput = container.querySelector(
        'input[type="file"][accept="image/*"]',
      ) as HTMLInputElement;
      const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "a.png", {
        type: "image/png",
      });
      fireEvent.change(imageInput, { target: { files: [file] } });
      await waitFor(() => expect(screen.getByText("a.png")).toBeInTheDocument());

      const draft = screen.getByPlaceholderText(/type your message|输入消息/i);
      await user.type(draft, "describe this");
      await user.click(screen.getByRole("button", { name: /^send$|^发送$/i }));

      await waitFor(() => expect(playgroundFetchStreamMock).toHaveBeenCalled());
      const call = playgroundFetchStreamMock.mock.calls[0][0] as FakeStreamInput;
      expect(Array.isArray(call.body.task)).toBe(true);
      const parts = call.body.task as Array<{ type: string }>;
      expect(parts.some((p) => p.type === "text")).toBe(true);
      expect(parts.some((p) => p.type === "image_url")).toBe(true);
    });
  });

  describe("MCP approval (Task 11 carried over)", () => {
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

    async function runToApproval(user: ReturnType<typeof userEvent.setup>) {
      scriptNextRun([
        {
          type: "step",
          step: {
            kind: "tool_call",
            name: "mcp__mcp_1__search",
            args: { q: "x" },
            toolCallId: "call3",
            tMs: 5,
          },
        },
        {
          type: "tool_approval",
          toolCallId: "call3",
          server: { id: "mcp_1", name: "higress-gw" },
          name: "mcp__mcp_1__search",
          args: { q: "x" },
        },
        { type: "done", messages: PAUSED_MCP_APPROVAL_TRANSCRIPT },
      ]);

      render(
        <MemoryRouter>
          <AgentPage />
        </MemoryRouter>,
      );

      await enableTools(user);
      const comboboxes = screen.getAllByRole("combobox");
      await user.click(comboboxes[1]);
      await user.click(screen.getByRole("option", { name: /chat-1/i }));
      await typeTaskAndSend(user, "search something via MCP");

      await waitFor(() => {
        expect(screen.getByTestId("mcp-approval-card")).toBeInTheDocument();
      });
    }

    it("renders the pending approval card; Approve re-runs with autoRunMcp=true", async () => {
      const user = userEvent.setup();
      await runToApproval(user);

      expect(useAgentStore.getState().pendingApproval).toEqual({
        toolCallId: "call3",
        server: { id: "mcp_1", name: "higress-gw" },
        name: "mcp__mcp_1__search",
        args: { q: "x" },
      });
      expect(useAgentStore.getState().autoRunMcp).toBe(false);

      playgroundFetchStreamMock.mockClear();
      scriptNextRun([{ type: "done" }]);

      await user.click(screen.getByRole("button", { name: /approve|批准/i }));

      await waitFor(() => {
        expect(useAgentStore.getState().pendingApproval).toBeNull();
      });
      // Approving one call must never mutate the persistent toggle.
      expect(useAgentStore.getState().autoRunMcp).toBe(false);
      expect(playgroundFetchStreamMock).toHaveBeenCalledTimes(1);
      const call = playgroundFetchStreamMock.mock.calls[0][0] as FakeStreamInput;
      expect(call.body.autoRunMcp).toBe(true);
      expect(call.body.messages).toEqual(PAUSED_MCP_APPROVAL_TRANSCRIPT);
      // The existing tool_call card from the paused run is appended to, not
      // cleared/restarted, by the approve resend.
      expect(screen.getByTestId("step-tool_call")).toBeInTheDocument();
    });

    it("locks the tool controls while an approval is pending, to prevent continuation corruption", async () => {
      // `running` flips false on the pausing `done` (see `startRun`'s
      // `finally`), so `disabled={slice.running}` alone would let the user
      // deselect the MCP server here, then Approve would omit
      // mcpServerIds/inlineTools/autoRunMcp from the resume request.
      const user = userEvent.setup();
      await runToApproval(user);

      expect(useAgentStore.getState().running).toBe(false);
      // The whole tool-selectors fieldset (Skill / Tools / MCP) is locked.
      expect(screen.getByTestId("agent-tool-controls")).toBeDisabled();
    });

    it("Reject just clears the pending approval card without re-running", async () => {
      const user = userEvent.setup();
      await runToApproval(user);

      playgroundFetchStreamMock.mockClear();
      await user.click(screen.getByRole("button", { name: /reject|拒绝/i }));

      await waitFor(() => {
        expect(useAgentStore.getState().pendingApproval).toBeNull();
      });
      expect(playgroundFetchStreamMock).not.toHaveBeenCalled();
    });
  });

  describe("pending inline tool (Task 8/11 carried over)", () => {
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

    it("renders a pending inline-tool card; submit resends the full transcript + result", async () => {
      scriptNextRun([
        {
          type: "tool_result_needed",
          toolCallId: "call2",
          name: "my_inline_tool",
          args: { foo: "bar" },
        },
        { type: "done", messages: PAUSED_INLINE_TOOL_TRANSCRIPT },
      ]);

      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <AgentPage />
        </MemoryRouter>,
      );

      await enableTools(user);
      const comboboxes = screen.getAllByRole("combobox");
      await user.click(comboboxes[1]);
      await user.click(screen.getByRole("option", { name: /chat-1/i }));
      await typeTaskAndSend(user, "call my inline tool");

      await waitFor(() => {
        expect(screen.getByText(/my_inline_tool/)).toBeInTheDocument();
      });
      expect(useAgentStore.getState().pendingInlineTool).toEqual({
        toolCallId: "call2",
        name: "my_inline_tool",
        args: { foo: "bar" },
      });

      playgroundFetchStreamMock.mockClear();
      scriptNextRun([{ type: "done" }]);

      const resultBox = screen.getByPlaceholderText(/paste|结果/i);
      await user.type(resultBox, "42");
      await user.click(screen.getByRole("button", { name: /submit|提交/i }));

      await waitFor(() => {
        expect(useAgentStore.getState().pendingInlineTool).toBeNull();
      });
      expect(playgroundFetchStreamMock).toHaveBeenCalledTimes(1);
      const call = playgroundFetchStreamMock.mock.calls[0][0] as FakeStreamInput;
      expect(call.body.messages).toEqual([
        ...PAUSED_INLINE_TOOL_TRANSCRIPT,
        { role: "tool", tool_call_id: "call2", content: "42" },
      ]);
    });
  });

  describe("Skill preset (Task 12 carried over)", () => {
    it("applying a skill from the dropdown loads its config into the store", async () => {
      skillsListData = [SAMPLE_SKILL];
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <AgentPage />
        </MemoryRouter>,
      );

      await enableTools(user);
      // [0] Skill dropdown (composer, renders before the right config panel).
      const comboboxes = screen.getAllByRole("combobox");
      await user.click(comboboxes[0]);
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

    it("存为 Skill 用当前配置调用 createSkill", async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <AgentPage />
        </MemoryRouter>,
      );

      await selectConnection(user);
      // The system message lives in the MessageComposer's collapsible field
      // (placeholder "Optional. e.g. …" / "可选。如：…").
      const systemPromptBox = screen.getByPlaceholderText(/^optional|^可选/i);
      await user.type(systemPromptBox, "custom prompt");

      await enableTools(user);
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

  describe("no tools mode: selectors always visible, agent knobs reveal when armed", () => {
    it("shows the tool bar (Skill/save-as) always, but hides agent-loop knobs until a tool is picked", () => {
      render(
        <MemoryRouter>
          <AgentPage />
        </MemoryRouter>,
      );
      // The tool bar is always present — the Skill combobox (2 total: Skill +
      // connection) and Save-as-skill button are visible with no tools picked.
      expect(screen.getAllByRole("combobox")).toHaveLength(2);
      expect(screen.getByText(/save as skill|存为 skill/i)).toBeInTheDocument();
      // ...but the agent-loop knobs (plan-first / max-steps) stay hidden until
      // the chat is actually armed with a tool.
      expect(screen.queryByText(/plan first|先写计划/i)).not.toBeInTheDocument();
    });

    it("reveals the agent-loop knobs once a tool is armed", async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <AgentPage />
        </MemoryRouter>,
      );
      await enableTools(user);
      expect(screen.getByText(/plan first|先写计划/i)).toBeInTheDocument();
    });
  });

  describe("sampling params panel (Task 12: ChatParams reused in both modes)", () => {
    it("shows the temperature control in tools-off (chat) mode", () => {
      render(
        <MemoryRouter>
          <AgentPage />
        </MemoryRouter>,
      );
      const { input } = getTemperatureField();
      expect(input).toBeInTheDocument();
    });

    it("still shows the temperature control once tools are enabled", async () => {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <AgentPage />
        </MemoryRouter>,
      );
      await enableTools(user);
      const { input } = getTemperatureField();
      expect(input).toBeInTheDocument();
    });

    it("tools-off: setting temperature then sending includes params.temperature in the request body", async () => {
      scriptNextRun([{ type: "done" }]);
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <AgentPage />
        </MemoryRouter>,
      );

      await selectConnection(user);
      const { input: tempInput } = getTemperatureField();
      fireEvent.change(tempInput, { target: { value: "0.4" } });
      expect(useAgentStore.getState().params.temperature).toBe(0.4);

      await typeTaskAndSend(user, "hi");

      const call = playgroundFetchStreamMock.mock.calls[0][0] as FakeStreamInput;
      expect(call.body.params?.temperature).toBe(0.4);
    });

    it("tools-on: setting temperature then sending includes params.temperature in the request body", async () => {
      scriptNextRun([{ type: "done" }]);
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <AgentPage />
        </MemoryRouter>,
      );

      await enableTools(user);
      const { input: tempInput } = getTemperatureField();
      fireEvent.change(tempInput, { target: { value: "0.7" } });

      const comboboxes = screen.getAllByRole("combobox");
      await user.click(comboboxes[1]);
      await user.click(screen.getByRole("option", { name: /chat-1/i }));
      await typeTaskAndSend(user, "what is 1+1?");

      const call = playgroundFetchStreamMock.mock.calls[0][0] as FakeStreamInput;
      expect(call.body.params?.temperature).toBe(0.7);
    });
  });

  describe("restoring a pre-unified-shape history entry (final-review fix)", () => {
    afterEach(() => {
      // Restore the default blank single-entry state so later tests (and
      // their own beforeEach) don't see this test's injected entry.
      useAgentHistoryStore.getState().reset();
    });

    it("does not crash when the restored snapshot has no `timeline` field (old IDB shape)", async () => {
      // Simulates an entry persisted before the Task 9 unified-shape
      // migration: `timeline` didn't exist yet on `AgentHistorySnapshot`, so
      // rows saved back then are missing it entirely — `snap.timeline` is
      // `undefined`, not `[]`. No `version` bump / `migrate` runs these
      // through, so they're restored as-is.
      const oldShapeSnapshot = {
        selectedConnectionId: "c1",
        systemPrompt: "",
        params: {},
        toolsEnabled: false,
        planFirst: false,
        maxSteps: 12,
        inlineTools: [],
        builtinTools: [],
        selectedMcpServerIds: [],
        autoRunMcp: false,
        verdict: null,
        // `input` / `task` / `timeline` intentionally absent.
      } as unknown as AgentHistorySnapshot;

      useAgentHistoryStore.setState({
        list: [
          {
            id: "old-entry",
            createdAt: "2026-01-01T00:00:00Z",
            preview: "old run",
            snapshot: oldShapeSnapshot,
          },
        ],
        currentId: "old-entry",
        restoreVersion: 1,
      });

      render(
        <MemoryRouter>
          <AgentPage />
        </MemoryRouter>,
      );

      // No throw during mount/restore, and the Timeline renders its empty
      // state instead of crashing on an undefined `.length`/iteration.
      await waitFor(() => {
        expect(useAgentStore.getState().timeline).toEqual([]);
      });
      expect(screen.queryByTestId(/^step-/)).not.toBeInTheDocument();
      expect(screen.queryByTestId("assistant-bubble")).not.toBeInTheDocument();
    });
  });
});
