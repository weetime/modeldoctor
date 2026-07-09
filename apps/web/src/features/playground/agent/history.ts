import type { AgentStep, AgentVerdict, ToolDef } from "@modeldoctor/contracts";
import { createHistoryStore } from "../history/createHistoryStore";

/**
 * A persisted agent run: the task + full config plus the resulting trajectory
 * (`steps`) and `verdict`. Transient fields (running / abortController / error /
 * pendingInlineTool / pendingApproval / continuationMessages) are intentionally
 * excluded — they only matter mid-run and never need to survive a reload.
 */
export interface AgentHistorySnapshot {
  selectedConnectionId: string | null;
  task: string;
  systemPrompt: string;
  planFirst: boolean;
  maxSteps: number;
  inlineTools: ToolDef[];
  builtinTools: string[];
  selectedMcpServerIds: string[];
  autoRunMcp: boolean;
  steps: AgentStep[];
  verdict: AgentVerdict | null;
}

export const useAgentHistoryStore = createHistoryStore<AgentHistorySnapshot>({
  name: "md-playground-history-agent",
  blank: () => ({
    selectedConnectionId: null,
    task: "",
    systemPrompt: "",
    planFirst: false,
    maxSteps: 12,
    inlineTools: [],
    builtinTools: [],
    selectedMcpServerIds: [],
    autoRunMcp: false,
    steps: [],
    verdict: null,
  }),
  preview: (s) => s.task.trim().slice(0, 80),
});
