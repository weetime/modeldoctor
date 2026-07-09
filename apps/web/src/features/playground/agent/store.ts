import type {
  AgentSseEvent,
  AgentStep,
  AgentVerdict,
  ChatMessage,
  ToolDef,
} from "@modeldoctor/contracts";
import { create } from "zustand";
import { reduceEvent, type TimelineItem } from "./timeline";

/** A `tool_result_needed` SSE event, held until the user supplies a result. */
export interface PendingInlineTool {
  toolCallId: string;
  name: string;
  args: unknown;
}

/** A `tool_approval` SSE event (MCP, Task 11), held until the user approves/rejects. */
export interface PendingMcpApproval {
  toolCallId: string;
  server: { id: string; name: string };
  name: string;
  args: unknown;
}

export interface AgentStoreState {
  selectedConnectionId: string | null;
  task: string;
  /**
   * Unified playground (Task 5+) composer draft text. Kept as a plain string
   * for now — multimodal attachments (images/files) are layered on in
   * Task 6. Distinct from `task`, which the legacy agent-only flow still
   * owns; both are kept until later tasks migrate rendering off `task`.
   */
  input: string;
  /** Sampling params (temperature, topP, ...) for the unified run request. */
  params: Record<string, unknown>;
  /** Whether the unified composer's tool picker is expanded/active. */
  toolsEnabled: boolean;
  systemPrompt: string;
  planFirst: boolean;
  maxSteps: number;
  inlineTools: ToolDef[];
  /** Names of server-side builtins (see `BUILTIN_TOOLS` on the API) to advertise. */
  builtinTools: string[];
  selectedMcpServerIds: string[];
  autoRunMcp: boolean;
  steps: AgentStep[];
  /**
   * Unified playground timeline (Task 5+) — the renderable item list derived
   * from the `AgentSseEvent` stream via `reduceEvent`. Additive alongside
   * `steps`: later tasks (7/8) migrate rendering off `steps` onto this.
   */
  timeline: TimelineItem[];
  pendingInlineTool: PendingInlineTool | null;
  pendingApproval: PendingMcpApproval | null;
  /**
   * The full-transcript continuation array carried by the most recent
   * `done` SSE event (only present when the server paused for a
   * `tool_result_needed` / `tool_approval`; `null` otherwise). The frontend
   * resends this array verbatim — plus one more `{role:"tool", ...}` entry
   * for an inline-tool result — as `AgentRunRequest.messages` to resume
   * without restarting the whole task from turn 0 (Task 11 fix pass).
   */
  continuationMessages: ChatMessage[] | null;
  /**
   * Lightweight trajectory judge verdict (Task 13), set from the `verdict`
   * SSE event — only emitted on a true run completion (never on a pausing
   * `done`, and never at all when no LLM-judge provider is configured).
   * Cleared alongside the rest of the trace by `clearSteps()` so a fresh run
   * doesn't show a stale verdict from the previous one.
   */
  verdict: AgentVerdict | null;
  running: boolean;
  abortController: AbortController | null;
  error: string | null;

  setSelectedConnectionId: (id: string | null) => void;
  setTask: (task: string) => void;
  setInput: (input: string) => void;
  patchParams: (p: Record<string, unknown>) => void;
  setToolsEnabled: (b: boolean) => void;
  appendEvent: (evt: AgentSseEvent) => void;
  setSystemPrompt: (s: string) => void;
  setPlanFirst: (b: boolean) => void;
  setMaxSteps: (n: number) => void;
  setInlineTools: (tools: ToolDef[]) => void;
  addInlineTool: (tool: ToolDef) => void;
  removeInlineTool: (index: number) => void;
  toggleBuiltinTool: (name: string, on: boolean) => void;
  setBuiltinTools: (names: string[]) => void;
  setSelectedMcpServerIds: (ids: string[]) => void;
  toggleMcpServer: (id: string, on: boolean) => void;
  setAutoRunMcp: (b: boolean) => void;
  appendStep: (step: AgentStep) => void;
  setSteps: (steps: AgentStep[]) => void;
  clearSteps: () => void;
  setPendingInlineTool: (tool: PendingInlineTool | null) => void;
  setPendingApproval: (approval: PendingMcpApproval | null) => void;
  setContinuationMessages: (messages: ChatMessage[] | null) => void;
  setVerdict: (v: AgentVerdict | null) => void;
  setRunning: (b: boolean) => void;
  setAbortController: (ac: AbortController | null) => void;
  setError: (s: string | null) => void;
  reset: () => void;
}

const initial = {
  selectedConnectionId: null as string | null,
  task: "",
  input: "",
  params: {} as Record<string, unknown>,
  toolsEnabled: false,
  systemPrompt: "",
  planFirst: false,
  maxSteps: 12,
  inlineTools: [] as ToolDef[],
  builtinTools: [] as string[],
  selectedMcpServerIds: [] as string[],
  autoRunMcp: false,
  steps: [] as AgentStep[],
  timeline: [] as TimelineItem[],
  pendingInlineTool: null as PendingInlineTool | null,
  pendingApproval: null as PendingMcpApproval | null,
  continuationMessages: null as ChatMessage[] | null,
  verdict: null as AgentVerdict | null,
  running: false,
  abortController: null as AbortController | null,
  error: null as string | null,
};

export const useAgentStore = create<AgentStoreState>((set) => ({
  ...initial,
  setSelectedConnectionId: (id) => set({ selectedConnectionId: id }),
  setTask: (task) => set({ task }),
  setInput: (input) => set({ input }),
  patchParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
  setToolsEnabled: (b) => set({ toolsEnabled: b }),
  appendEvent: (evt) => set((s) => ({ timeline: reduceEvent(s.timeline, evt) })),
  setSystemPrompt: (s) => set({ systemPrompt: s }),
  setPlanFirst: (b) => set({ planFirst: b }),
  setMaxSteps: (n) => set({ maxSteps: n }),
  setInlineTools: (tools) => set({ inlineTools: tools }),
  addInlineTool: (tool) => set((s) => ({ inlineTools: [...s.inlineTools, tool] })),
  removeInlineTool: (index) =>
    set((s) => ({ inlineTools: s.inlineTools.filter((_, i) => i !== index) })),
  toggleBuiltinTool: (name, on) =>
    set((s) => ({
      builtinTools: on
        ? s.builtinTools.includes(name)
          ? s.builtinTools
          : [...s.builtinTools, name]
        : s.builtinTools.filter((n) => n !== name),
    })),
  setBuiltinTools: (names) => set({ builtinTools: names }),
  setSelectedMcpServerIds: (ids) => set({ selectedMcpServerIds: ids }),
  toggleMcpServer: (id, on) =>
    set((s) => ({
      selectedMcpServerIds: on
        ? s.selectedMcpServerIds.includes(id)
          ? s.selectedMcpServerIds
          : [...s.selectedMcpServerIds, id]
        : s.selectedMcpServerIds.filter((i) => i !== id),
    })),
  setAutoRunMcp: (b) => set({ autoRunMcp: b }),
  appendStep: (step) => set((s) => ({ steps: [...s.steps, step] })),
  setSteps: (steps) => set({ steps }),
  clearSteps: () =>
    set({
      steps: [],
      timeline: [],
      pendingInlineTool: null,
      pendingApproval: null,
      continuationMessages: null,
      verdict: null,
      error: null,
    }),
  setPendingInlineTool: (tool) => set({ pendingInlineTool: tool }),
  setPendingApproval: (approval) => set({ pendingApproval: approval }),
  setContinuationMessages: (messages) => set({ continuationMessages: messages }),
  setVerdict: (v) => set({ verdict: v }),
  setRunning: (b) => set({ running: b }),
  setAbortController: (ac) => set({ abortController: ac }),
  setError: (e) => set({ error: e }),
  reset: () => set({ ...initial }),
}));
