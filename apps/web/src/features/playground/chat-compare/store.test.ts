import type { ChatMessage } from "@modeldoctor/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCompareStore } from "./store";

describe("useCompareStore", () => {
  beforeEach(() => {
    localStorage.clear();
    // reset by calling setPanelCount(2) + clearAllMessages + setSharedSystemMessage("")
    useCompareStore.setState((s) => ({
      ...s,
      panelCount: 2,
      panels: s.panels.slice(0, 2).map(() => ({
        selectedConnectionId: null, params: {}, messages: [],
        sending: false, streaming: false, abortController: null, error: null,
      })),
      sharedSystemMessage: "",
    }));
  });

  it("starts with 2 default panels", () => {
    const s = useCompareStore.getState();
    expect(s.panelCount).toBe(2);
    expect(s.panels).toHaveLength(2);
    expect(s.panels[0].selectedConnectionId).toBeNull();
    expect(s.panels[0].messages).toEqual([]);
  });

  it("setPanelCount grows from 2 → 4 with blank panels", () => {
    useCompareStore.getState().setPanelCount(4);
    const s = useCompareStore.getState();
    expect(s.panelCount).toBe(4);
    expect(s.panels).toHaveLength(4);
    expect(s.panels[3].selectedConnectionId).toBeNull();
  });

  it("setPanelCount shrinks 4 → 2 dropping the tail", () => {
    useCompareStore.getState().setPanelCount(4);
    useCompareStore.getState().setPanelConnection(3, "conn-tail");
    useCompareStore.getState().setPanelCount(2);
    const s = useCompareStore.getState();
    expect(s.panels).toHaveLength(2);
    expect(s.panels.find((p) => p.selectedConnectionId === "conn-tail")).toBeUndefined();
  });

  it("appendMessageToPanel only mutates the indexed panel", () => {
    const m: ChatMessage = { role: "user", content: "hi" };
    useCompareStore.getState().appendMessageToPanel(0, m);
    const s = useCompareStore.getState();
    expect(s.panels[0].messages).toEqual([m]);
    expect(s.panels[1].messages).toEqual([]);
  });

  it("appendAssistantTokenToPanel concatenates", () => {
    useCompareStore.getState().appendAssistantTokenToPanel(0, "hel");
    useCompareStore.getState().appendAssistantTokenToPanel(0, "lo");
    expect(useCompareStore.getState().panels[0].messages).toEqual([
      { role: "assistant", content: "hello" },
    ]);
  });

  it("clearPanelMessages only clears the indexed panel", () => {
    useCompareStore.getState().appendMessageToPanel(0, { role: "user", content: "a" });
    useCompareStore.getState().appendMessageToPanel(1, { role: "user", content: "b" });
    useCompareStore.getState().clearPanelMessages(0);
    const s = useCompareStore.getState();
    expect(s.panels[0].messages).toEqual([]);
    expect(s.panels[1].messages).toHaveLength(1);
  });

  it("abortAll calls every active abortController", () => {
    const ac0 = new AbortController();
    const ac1 = new AbortController();
    const spy0 = vi.spyOn(ac0, "abort");
    const spy1 = vi.spyOn(ac1, "abort");
    useCompareStore.getState().setPanelAbortController(0, ac0);
    useCompareStore.getState().setPanelAbortController(1, ac1);
    useCompareStore.getState().abortAll();
    expect(spy0).toHaveBeenCalled();
    expect(spy1).toHaveBeenCalled();
  });

  it("rehydrates ephemeral fields as blank after persist roundtrip", async () => {
    // simulate a previously-persisted layout with messages baked in
    localStorage.setItem(
      "md-playground-chat-compare-layout",
      JSON.stringify({
        state: {
          panelCount: 3,
          sharedSystemMessage: "be terse",
          panels: [
            { selectedConnectionId: "x", params: { temperature: 0.7 } },
            { selectedConnectionId: null, params: {} },
            { selectedConnectionId: "y", params: {} },
          ],
        },
        version: 1,
      }),
    );

    // force a fresh store creation by re-importing — vitest pattern: reset modules
    vi.resetModules();
    const mod = await import("./store");
    const s = mod.useCompareStore.getState();
    expect(s.panelCount).toBe(3);
    expect(s.sharedSystemMessage).toBe("be terse");
    expect(s.panels).toHaveLength(3);
    expect(s.panels[0].selectedConnectionId).toBe("x");
    expect(s.panels[0].params.temperature).toBe(0.7);
    // ephemeral wiped:
    for (const p of s.panels) {
      expect(p.messages).toEqual([]);
      expect(p.sending).toBe(false);
      expect(p.streaming).toBe(false);
      expect(p.abortController).toBeNull();
      expect(p.error).toBeNull();
    }
  });
});
