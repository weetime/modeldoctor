import type { AgentSseEvent, AgentStep, AgentVerdict } from "@modeldoctor/contracts";

/**
 * A single renderable item in the unified playground timeline (Task 5).
 * Produced from the raw `AgentSseEvent` stream by `reduceEvent` below.
 *
 * `assistant_text` bubbles are mutable while `closed:false` (still receiving
 * `text_delta` / `reasoning_delta` chunks for the current turn); `assistant_end`
 * closes the most recent open bubble. `reasoning` holds a reasoning model's
 * chain-of-thought (streamed first, before `content`); it stays `undefined`
 * for non-reasoning models. `tool_result_needed` / `tool_approval` / `done`
 * do NOT produce a timeline item — the store holds those as separate pending /
 * continuation fields (see `store.ts`).
 */
export type TimelineItem =
  | { kind: "assistant_text"; content: string; reasoning?: string; closed: boolean }
  | { kind: "tool_call" | "tool_result" | "plan" | "error"; step: AgentStep }
  | { kind: "verdict"; verdict: AgentVerdict };

/**
 * Pure reducer: folds one `AgentSseEvent` onto the current timeline, always
 * returning a NEW array (never mutates `items` or its entries) so it's safe
 * to use directly as a zustand `set()` updater.
 */
export function reduceEvent(items: TimelineItem[], evt: AgentSseEvent): TimelineItem[] {
  switch (evt.type) {
    case "text_delta": {
      const last = items[items.length - 1];
      if (last?.kind === "assistant_text" && !last.closed) {
        // Spread `last` so an already-accumulated `reasoning` (streamed
        // before the answer began) is preserved as content appends.
        return [...items.slice(0, -1), { ...last, content: last.content + evt.delta }];
      }
      return [...items, { kind: "assistant_text", content: evt.delta, closed: false }];
    }
    case "reasoning_delta": {
      // Reasoning streams FIRST, before any `text_delta`, so this usually
      // opens the bubble (with empty `content`); the later `text_delta`
      // chunks append answer text to the same open bubble.
      const last = items[items.length - 1];
      if (last?.kind === "assistant_text" && !last.closed) {
        return [...items.slice(0, -1), { ...last, reasoning: (last.reasoning ?? "") + evt.delta }];
      }
      return [
        ...items,
        { kind: "assistant_text", content: "", reasoning: evt.delta, closed: false },
      ];
    }
    case "assistant_end": {
      const last = items[items.length - 1];
      if (last?.kind === "assistant_text" && !last.closed) {
        return [...items.slice(0, -1), { ...last, closed: true }];
      }
      return items;
    }
    case "step": {
      const { step } = evt;
      if (
        step.kind === "plan" ||
        step.kind === "tool_call" ||
        step.kind === "tool_result" ||
        step.kind === "error"
      ) {
        return [...items, { kind: step.kind, step }];
      }
      // `assistant` steps are the legacy full-turn shape (Task 8); the
      // unified stream carries turn text via `text_delta`/`assistant_end`
      // instead, so they're not added to the timeline.
      return items;
    }
    case "verdict":
      return [...items, { kind: "verdict", verdict: evt.verdict }];
    case "tool_result_needed":
    case "tool_approval":
    case "done":
      return items;
    default:
      return items;
  }
}
