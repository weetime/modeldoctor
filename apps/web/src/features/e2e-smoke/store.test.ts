import { beforeEach, describe, expect, it } from "vitest";
import { useE2EStore } from "./store";

const PERSIST_KEY = "md.e2e.v2";

function storedState(): Record<string, unknown> | null {
  const raw = localStorage.getItem(PERSIST_KEY);
  if (!raw) return null;
  return (JSON.parse(raw) as { state: Record<string, unknown> }).state;
}

describe("useE2EStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useE2EStore.getState().reset();
  });

  it("starts with empty endpoint, no selection, default category 'chat', no results", () => {
    const s = useE2EStore.getState();
    expect(s.selectedConnectionId).toBeNull();
    expect(s.manualEndpoint).toEqual({
      apiBaseUrl: "",
      apiKey: "",
      model: "",
      customHeaders: "",
      queryParams: "",
    });
    expect(s.selectedCategory).toBe("chat");
    expect(s.pathOverrides).toEqual({});
    expect(s.results).toEqual({});
    expect(s.running).toEqual({});
  });

  it("setResult / setRunning update the specific probe only (sparse map)", () => {
    useE2EStore.getState().setRunning("chat-text", true);
    useE2EStore.getState().setResult("chat-vision", {
      pass: true,
      latencyMs: 42,
      checks: [],
      details: {},
    });
    const s = useE2EStore.getState();
    expect(s.running["chat-text"]).toBe(true);
    expect(s.running["chat-vision"]).toBeUndefined();
    expect(s.results["chat-vision"]?.pass).toBe(true);
    expect(s.results["chat-text"]).toBeUndefined();
  });

  it("resetResults clears outputs but preserves endpoint, selection, category, overrides", () => {
    const store = useE2EStore.getState();
    store.setSelected("conn-1");
    store.setManualEndpoint({
      apiBaseUrl: "http://a",
      apiKey: "k",
      model: "m",
      customHeaders: "",
      queryParams: "",
    });
    store.setSelectedCategory("audio");
    store.setPathOverride("tts", "/custom/tts");
    store.setResult("chat-text", {
      pass: false,
      latencyMs: 5,
      checks: [],
      details: {},
    });
    store.setRunning("chat-vision", true);

    store.resetResults();

    const s = useE2EStore.getState();
    expect(s.selectedConnectionId).toBe("conn-1");
    expect(s.manualEndpoint.apiBaseUrl).toBe("http://a");
    expect(s.selectedCategory).toBe("audio");
    expect(s.pathOverrides).toEqual({ tts: "/custom/tts" });
    expect(s.results).toEqual({});
    expect(s.running).toEqual({});
  });

  it("setPathOverride / clearPathOverride toggle a key", () => {
    const store = useE2EStore.getState();
    store.setPathOverride("rerank-tei", "/v2/rerank");
    expect(useE2EStore.getState().pathOverrides["rerank-tei"]).toBe("/v2/rerank");

    store.clearPathOverride("rerank-tei");
    expect(useE2EStore.getState().pathOverrides["rerank-tei"]).toBeUndefined();
  });

  it("persists endpoint, selectedCategory, and pathOverrides to localStorage v2 key", () => {
    const store = useE2EStore.getState();
    store.setManualEndpoint({
      apiBaseUrl: "http://b",
      apiKey: "k",
      model: "m",
      customHeaders: "",
      queryParams: "",
    });
    store.setSelectedCategory("embeddings");
    store.setPathOverride("embeddings-tei", "/v2/embed");

    const persisted = storedState();
    expect(persisted).not.toBeNull();
    expect(persisted?.manualEndpoint).toMatchObject({ apiBaseUrl: "http://b" });
    expect(persisted?.selectedCategory).toBe("embeddings");
    expect(persisted?.pathOverrides).toEqual({ "embeddings-tei": "/v2/embed" });
  });

  it("does NOT persist results or running (transient by design)", () => {
    const store = useE2EStore.getState();
    store.setRunning("chat-text", true);
    store.setResult("chat-vision", { pass: true, latencyMs: 10, checks: [], details: {} });

    const persisted = storedState();
    expect(persisted).not.toBeNull();
    expect(persisted?.results).toBeUndefined();
    expect(persisted?.running).toBeUndefined();
  });
});
