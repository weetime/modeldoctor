import type { ChatMessage } from "@modeldoctor/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "./store";

describe("useChatStore", () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  it("starts empty", () => {
    const s = useChatStore.getState();
    expect(s.selectedConnectionId).toBeNull();
    expect(s.messages).toEqual([]);
    expect(s.systemMessage).toBe("");
    expect(s.sending).toBe(false);
  });

  it("appendMessage adds to the end", () => {
    const m: ChatMessage = { role: "user", content: "hi" };
    useChatStore.getState().appendMessage(m);
    expect(useChatStore.getState().messages).toEqual([m]);
  });

  it("setSelected stores the connection id", () => {
    useChatStore.getState().setSelected("conn-1");
    expect(useChatStore.getState().selectedConnectionId).toBe("conn-1");
  });

  it("patchParams merges with existing params", () => {
    useChatStore.getState().patchParams({ temperature: 0.5 });
    useChatStore.getState().patchParams({ maxTokens: 100 });
    expect(useChatStore.getState().params).toEqual({ temperature: 0.5, maxTokens: 100 });
  });

  it("clearMessages keeps system message but drops messages", () => {
    useChatStore.getState().setSystemMessage("you are helpful");
    useChatStore.getState().appendMessage({ role: "user", content: "hi" });
    useChatStore.getState().clearMessages();
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().systemMessage).toBe("you are helpful");
  });

  it("reset wipes everything", () => {
    useChatStore.getState().setSystemMessage("x");
    useChatStore.getState().appendMessage({ role: "user", content: "y" });
    useChatStore.getState().setSelected("c");
    useChatStore.getState().reset();
    expect(useChatStore.getState().selectedConnectionId).toBeNull();
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().systemMessage).toBe("");
  });
});
