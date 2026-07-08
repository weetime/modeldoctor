import type { AgentStep, ChatMessage, ToolDef } from "@modeldoctor/contracts";
import { create } from "zustand";

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
  systemPrompt: string;
  planFirst: boolean;
  maxSteps: number;
  inlineTools: ToolDef[];
  /** Names of server-side builtins (see `BUILTIN_TOOLS` on the API) to advertise. */
  builtinTools: string[];
  selectedMcpServerIds: string[];
  autoRunMcp: boolean;
  steps: AgentStep[];
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
  running: boolean;
  abortController: AbortController | null;
  error: string | null;

  setSelectedConnectionId: (id: string | null) => void;
  setTask: (task: string) => void;
  setSystemPrompt: (s: string) => void;
  setPlanFirst: (b: boolean) => void;
  setMaxSteps: (n: number) => void;
  setInlineTools: (tools: ToolDef[]) => void;
  addInlineTool: (tool: ToolDef) => void;
  removeInlineTool: (index: number) => void;
  toggleBuiltinTool: (name: string, on: boolean) => void;
  setSelectedMcpServerIds: (ids: string[]) => void;
  toggleMcpServer: (id: string, on: boolean) => void;
  setAutoRunMcp: (b: boolean) => void;
  appendStep: (step: AgentStep) => void;
  clearSteps: () => void;
  setPendingInlineTool: (tool: PendingInlineTool | null) => void;
  setPendingApproval: (approval: PendingMcpApproval | null) => void;
  setContinuationMessages: (messages: ChatMessage[] | null) => void;
  setRunning: (b: boolean) => void;
  setAbortController: (ac: AbortController | null) => void;
  setError: (s: string | null) => void;
  reset: () => void;
}

const initial = {
  selectedConnectionId: null as string | null,
  task: "",
  systemPrompt: "",
  planFirst: false,
  maxSteps: 12,
  inlineTools: [] as ToolDef[],
  builtinTools: [] as string[],
  selectedMcpServerIds: [] as string[],
  autoRunMcp: false,
  steps: [] as AgentStep[],
  pendingInlineTool: null as PendingInlineTool | null,
  pendingApproval: null as PendingMcpApproval | null,
  continuationMessages: null as ChatMessage[] | null,
  running: false,
  abortController: null as AbortController | null,
  error: null as string | null,
};

export const useAgentStore = create<AgentStoreState>((set) => ({
  ...initial,
  setSelectedConnectionId: (id) => set({ selectedConnectionId: id }),
  setTask: (task) => set({ task }),
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
  clearSteps: () =>
    set({
      steps: [],
      pendingInlineTool: null,
      pendingApproval: null,
      continuationMessages: null,
      error: null,
    }),
  setPendingInlineTool: (tool) => set({ pendingInlineTool: tool }),
  setPendingApproval: (approval) => set({ pendingApproval: approval }),
  setContinuationMessages: (messages) => set({ continuationMessages: messages }),
  setRunning: (b) => set({ running: b }),
  setAbortController: (ac) => set({ abortController: ac }),
  setError: (e) => set({ error: e }),
  reset: () => set({ ...initial }),
}));
