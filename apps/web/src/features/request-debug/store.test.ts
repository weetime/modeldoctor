import { beforeEach, describe, expect, it } from "vitest";
import { useDebugStore } from "./store";
import type { DebugResponse } from "./types";

const PERSIST_KEY = "md.debug.v1";

const FAKE_RESPONSE: DebugResponse = {
  status: 200,
  statusText: "OK",
  headers: { "content-type": "application/json" },
  body: "{}",
  bodyEncoding: "text",
  timingMs: { ttfbMs: 5, totalMs: 7 },
  sizeBytes: 2,
};

function storedState(): Record<string, unknown> | null {
  const raw = localStorage.getItem(PERSIST_KEY);
  if (!raw) return null;
  return (JSON.parse(raw) as { state: Record<string, unknown> }).state;
}

describe("useDebugStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useDebugStore.getState().reset();
  });

  it("starts with POST + a single Content-Type header", () => {
    const s = useDebugStore.getState();
    expect(s.method).toBe("POST");
    expect(s.url).toBe("");
    expect(s.headers).toEqual([{ key: "Content-Type", value: "application/json", enabled: true }]);
    expect(s.lastResponse).toBeNull();
    expect(s.lastError).toBeNull();
  });

  it("setLastResponse clears lastError and vice versa", () => {
    useDebugStore.getState().setLastError("boom");
    expect(useDebugStore.getState().lastError).toBe("boom");
    useDebugStore.getState().setLastResponse(FAKE_RESPONSE);
    const s = useDebugStore.getState();
    expect(s.lastResponse?.status).toBe(200);
    expect(s.lastError).toBeNull();

    useDebugStore.getState().setLastError("boom2");
    expect(useDebugStore.getState().lastResponse).toBeNull();
  });

  it("resetResults clears response + error, preserves form config", () => {
    const s = useDebugStore.getState();
    s.patch("url", "http://a");
    s.patch("body", '{"x": 1}');
    s.setLastResponse(FAKE_RESPONSE);
    s.setLastError("stale");

    useDebugStore.getState().resetResults();
    const after = useDebugStore.getState();
    expect(after.lastResponse).toBeNull();
    expect(after.lastError).toBeNull();
    expect(after.url).toBe("http://a");
    expect(after.body).toBe('{"x": 1}');
  });

  it("does not persist lastResponse / lastError", () => {
    const s = useDebugStore.getState();
    s.patch("url", "http://persisted");
    s.setLastResponse(FAKE_RESPONSE);
    s.setLastError("should-not-persist");

    const persisted = storedState();
    expect(persisted).not.toBeNull();
    expect(persisted).not.toHaveProperty("lastResponse");
    expect(persisted).not.toHaveProperty("lastError");
    expect((persisted as { url: string }).url).toBe("http://persisted");
  });
});
