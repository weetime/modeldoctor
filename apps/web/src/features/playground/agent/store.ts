import type { AgentStep, ToolDef } from "@modeldoctor/contracts";
import { create } from "zustand";

/** A `tool_result_needed` SSE event, held until the user supplies a result. */
export interface PendingInlineTool {
  toolCallId: string;
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
  clearSteps: () => set({ steps: [], pendingInlineTool: null, error: null }),
  setPendingInlineTool: (tool) => set({ pendingInlineTool: tool }),
  setRunning: (b) => set({ running: b }),
  setAbortController: (ac) => set({ abortController: ac }),
  setError: (e) => set({ error: e }),
  reset: () => set({ ...initial }),
}));
