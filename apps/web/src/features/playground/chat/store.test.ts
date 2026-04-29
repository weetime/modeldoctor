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

  it("initializes params with OpenAI-default values for the 5 sliderable fields", () => {
    // stream:true added in Phase 2 — streaming is now the default playground UX
    expect(useChatStore.getState().params).toEqual({
      temperature: 1,
      maxTokens: 1024,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      stream: true,
    });
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
    expect(useChatStore.getState().params).toMatchObject({
      temperature: 0.5,
      maxTokens: 100,
    });
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

describe("ChatStore — streaming additions", () => {
  beforeEach(() => useChatStore.getState().reset());

  it("appendAssistantToken creates a new assistant message if last is not assistant", () => {
    useChatStore.getState().appendMessage({ role: "user", content: "hi" });
    useChatStore.getState().appendAssistantToken("hel");
    expect(useChatStore.getState().messages.at(-1)).toEqual({
      role: "assistant",
      content: "hel",
    });
  });

  it("appendAssistantToken extends the last assistant message", () => {
    useChatStore.getState().appendAssistantToken("hel");
    useChatStore.getState().appendAssistantToken("lo");
    expect(useChatStore.getState().messages).toEqual([{ role: "assistant", content: "hello" }]);
  });

  it("setStreaming + setAbortController track stream lifecycle", () => {
    const ac = new AbortController();
    useChatStore.getState().setStreaming(true);
    useChatStore.getState().setAbortController(ac);
    expect(useChatStore.getState().streaming).toBe(true);
    expect(useChatStore.getState().abortController).toBe(ac);
    useChatStore.getState().setStreaming(false);
    useChatStore.getState().setAbortController(null);
    expect(useChatStore.getState().abortController).toBeNull();
  });

  it("reset clears streaming + abortController", () => {
    useChatStore.getState().setStreaming(true);
    useChatStore.getState().setAbortController(new AbortController());
    useChatStore.getState().reset();
    expect(useChatStore.getState().streaming).toBe(false);
    expect(useChatStore.getState().abortController).toBeNull();
  });
});
