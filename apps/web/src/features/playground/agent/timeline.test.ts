import type { AgentSseEvent } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import { reduceEvent, type TimelineItem } from "./timeline";

function fold(events: AgentSseEvent[]): TimelineItem[] {
  return events.reduce(reduceEvent, [] as TimelineItem[]);
}

describe("reduceEvent", () => {
  it("folds the brief's sequence into the expected timeline", () => {
    const events: AgentSseEvent[] = [
      { type: "text_delta", delta: "He" },
      { type: "text_delta", delta: "llo" },
      { type: "assistant_end" },
      { type: "step", step: { kind: "tool_call", name: "calc", args: {}, tMs: 1 } },
      { type: "step", step: { kind: "tool_result", content: "42", tMs: 2 } },
      { type: "text_delta", delta: "done" },
      { type: "assistant_end" },
      {
        type: "verdict",
        verdict: {
          taskCompleted: true,
          toolUseCorrect: true,
          extraSteps: 0,
          oneLineVerdict: "ok",
        },
      },
    ];

    const timeline = fold(events);

    expect(timeline).toHaveLength(5);
    expect(timeline[0]).toEqual({ kind: "assistant_text", content: "Hello", closed: true });
    expect(timeline[1]).toEqual({
      kind: "tool_call",
      step: events[3]?.type === "step" ? events[3].step : undefined,
    });
    expect(timeline[2]).toEqual({
      kind: "tool_result",
      step: events[4]?.type === "step" ? events[4].step : undefined,
    });
    expect(timeline[3]).toEqual({ kind: "assistant_text", content: "done", closed: true });
    expect(timeline[4]).toEqual({
      kind: "verdict",
      verdict: events[7]?.type === "verdict" ? events[7].verdict : undefined,
    });
  });

  it("does not add tool_result_needed or done to the timeline", () => {
    const events: AgentSseEvent[] = [
      { type: "text_delta", delta: "hi" },
      { type: "tool_result_needed", toolCallId: "t1", name: "custom", args: {} },
      { type: "done" },
    ];

    const timeline = fold(events);

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toEqual({ kind: "assistant_text", content: "hi", closed: false });
  });

  it("starts a new bubble for text_delta after an assistant_end, not appending to the closed one", () => {
    const events: AgentSseEvent[] = [
      { type: "text_delta", delta: "first" },
      { type: "assistant_end" },
      { type: "text_delta", delta: "second" },
    ];

    const timeline = fold(events);

    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toEqual({ kind: "assistant_text", content: "first", closed: true });
    expect(timeline[1]).toEqual({ kind: "assistant_text", content: "second", closed: false });
  });

  it("assistant_end with no open bubble is a no-op", () => {
    const items = reduceEvent([], { type: "assistant_end" });
    expect(items).toEqual([]);
  });

  it("returns a new array reference on every call", () => {
    const items: TimelineItem[] = [];
    const next = reduceEvent(items, { type: "text_delta", delta: "x" });
    expect(next).not.toBe(items);
  });
});
