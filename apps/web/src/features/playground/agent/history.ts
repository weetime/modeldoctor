import type { AgentVerdict, ChatMessage, ToolDef } from "@modeldoctor/contracts";
import { createHistoryStore } from "../history/createHistoryStore";
import type { TimelineItem } from "./timeline";

/**
 * A persisted unified-playground agent run: the input + full config plus the
 * resulting `timeline` (Task 5+ renderable trace) and `verdict`. Transient
 * fields (running / abortController / error / pendingInlineTool /
 * pendingApproval / continuationMessages) are intentionally excluded — they
 * only matter mid-run and never need to survive a reload.
 *
 * Unified-shape migration (Task 9): this used to persist `steps`
 * (`AgentStep[]`), but the unified run dispatch (`startRun` in
 * `AgentPage.tsx`) only ever calls `store.appendEvent` — it stopped
 * populating `store.steps` back in the Task 5+ migration, so `steps` here
 * was silently always `[]`. Persistence now follows the live store onto
 * `timeline`, which IS kept up to date by every run.
 *
 * Attachment blobs (mirroring chat's `persistMessageAttachments` /
 * `rehydrateMessageBlobs`): NOT wired up here. Unlike chat, where the
 * `ChatMessage[]` transcript (with inline `data:` URLs) IS the persisted
 * state, the agent flow only ever stores the composer's plain-text draft
 * (`task/input`, both `string`) — multimodal attachments
 * (`AttachedFile[]`, see `../chat/attachments.ts`) live in
 * `MessageComposer`'s local component state and are folded into
 * `ChatMessageContentPart[]` transiently inside `startRun`'s request body,
 * never written into the zustand store or the `timeline` (see
 * `reduceEvent` in `./timeline.ts` — there is no "user message" timeline
 * item at all, only assistant/tool/plan/error/verdict items). So there is
 * currently no binary data anywhere in an `AgentHistorySnapshot` to move
 * into IDB blobs; wiring the blob layer here would be a no-op today. If a
 * later task adds a user-turn timeline item that carries
 * `ChatMessageContentPart[]`, revisit this and add the same
 * persist/rehydrate pairing chat uses.
 */
export interface AgentHistorySnapshot {
  selectedConnectionId: string | null;
  /** Unified composer draft text (Task 5+ `store.input`). */
  input?: string;
  systemPrompt: string;
  /** Legacy agent-only task string (`store.task`) — kept for the preview + placeholder use. */
  task?: string;
  params: Record<string, unknown>;
  /**
   * Legacy: whether the run had tools armed. The manual "tools mode" flag was
   * removed — tool-presence is now derived from `builtinTools`/`inlineTools`/
   * `selectedMcpServerIds` (see `hasToolsSelected`). Kept optional so old IDB
   * rows still restore, and written on save (= derived) for forward reads; it
   * no longer gates anything on restore.
   */
  toolsEnabled?: boolean;
  planFirst: boolean;
  maxSteps: number;
  inlineTools: ToolDef[];
  builtinTools: string[];
  selectedMcpServerIds: string[];
  autoRunMcp: boolean;
  timeline: TimelineItem[];
  /**
   * The running multi-turn transcript (`store.conversation`) — persisted so a
   * restored conversation keeps its memory (the model still gets prior turns
   * as context on the next send), not just the rendered bubbles. Optional for
   * back-compat with entries saved before multi-turn chat landed.
   */
  conversation?: ChatMessage[];
  verdict: AgentVerdict | null;
}

export const useAgentHistoryStore = createHistoryStore<AgentHistorySnapshot>({
  name: "md-playground-history-agent",
  blank: () => ({
    selectedConnectionId: null,
    input: "",
    systemPrompt: "",
    task: "",
    params: {},
    planFirst: false,
    maxSteps: 12,
    inlineTools: [],
    builtinTools: [],
    selectedMcpServerIds: [],
    autoRunMcp: false,
    timeline: [],
    conversation: [],
    verdict: null,
  }),
  preview: (s) => (s.task ?? s.input ?? "").trim().slice(0, 80),
});
