import { describe, expect, it } from "vitest";
import { type AgentHistorySnapshot, useAgentHistoryStore } from "./history";

function snap(task: string): AgentHistorySnapshot {
  return {
    selectedConnectionId: "c1",
    task,
    systemPrompt: "",
    planFirst: false,
    maxSteps: 12,
    inlineTools: [],
    builtinTools: ["calculator"],
    selectedMcpServerIds: ["m1"],
    autoRunMcp: true,
    steps: [{ kind: "assistant", content: "hi", tMs: 1 }],
    verdict: null,
  };
}

describe("useAgentHistoryStore", () => {
  it("saves a run, archives it on newSession, and restores it", () => {
    useAgentHistoryStore.getState().save(snap("list tenants then query quota"));

    const firstId = useAgentHistoryStore.getState().currentId;
    const saved = useAgentHistoryStore.getState().list.find((e) => e.id === firstId);
    expect(saved?.snapshot.task).toBe("list tenants then query quota");
    expect(saved?.snapshot.builtinTools).toEqual(["calculator"]);
    expect(saved?.snapshot.steps).toHaveLength(1);
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
    expect(restored.list.find((e) => e.id === restored.currentId)?.snapshot.task).toBe(
      "list tenants then query quota",
    );
  });
});
