import { describe, expect, it } from "vitest";
import { type AgentHistorySnapshot, useAgentHistoryStore } from "./history";
import type { TimelineItem } from "./timeline";

function snap(task: string, timeline: TimelineItem[]): AgentHistorySnapshot {
  return {
    selectedConnectionId: "c1",
    input: "",
    task,
    systemPrompt: "",
    params: { temperature: 0.7 },
    toolsEnabled: true,
    planFirst: false,
    maxSteps: 12,
    inlineTools: [],
    builtinTools: ["calculator"],
    selectedMcpServerIds: ["m1"],
    autoRunMcp: true,
    timeline,
    verdict: null,
  };
}

describe("useAgentHistoryStore", () => {
  it("saves a run's timeline (not steps), archives it on newSession, and restores it", () => {
    const timeline: TimelineItem[] = [
      { kind: "assistant_text", content: "hi", closed: true },
      {
        kind: "tool_call",
        step: { kind: "tool_call", name: "calculator", args: { a: 1 }, tMs: 5 },
      },
    ];
    useAgentHistoryStore.getState().save(snap("list tenants then query quota", timeline));

    const firstId = useAgentHistoryStore.getState().currentId;
    const saved = useAgentHistoryStore.getState().list.find((e) => e.id === firstId);
    expect(saved?.snapshot.task).toBe("list tenants then query quota");
    expect(saved?.snapshot.builtinTools).toEqual(["calculator"]);
    expect(saved?.snapshot.params).toEqual({ temperature: 0.7 });
    expect(saved?.snapshot.toolsEnabled).toBe(true);
    // Timeline round-trips intact — this is the regression this task fixes:
    // the unified run dispatch only ever populates `store.timeline`, never
    // `store.steps`, so persistence must follow it onto `timeline`.
    expect(saved?.snapshot.timeline).toEqual(timeline);
    // preview surfaces the task text (truncated to 80 chars).
    expect(saved?.preview).toBe("list tenants then query quota");

    // A new session archives the current entry under a fresh current id.
    useAgentHistoryStore.getState().newSession();
    const afterNew = useAgentHistoryStore.getState();
    expect(afterNew.currentId).not.toBe(firstId);
    expect(afterNew.list.some((e) => e.id === firstId)).toBe(true);

    // Restoring copies the archived snapshot back into the current entry and
    // bumps restoreVersion so the page effect re-hydrates the domain store.
    const beforeVersion = useAgentHistoryStore.getState().restoreVersion;
    useAgentHistoryStore.getState().restore(firstId);
    const restored = useAgentHistoryStore.getState();
    expect(restored.restoreVersion).toBeGreaterThan(beforeVersion);
    const restoredEntry = restored.list.find((e) => e.id === restored.currentId);
    expect(restoredEntry?.snapshot.task).toBe("list tenants then query quota");
    expect(restoredEntry?.snapshot.timeline).toEqual(timeline);
  });
});
