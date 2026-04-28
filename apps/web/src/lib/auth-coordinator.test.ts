import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("coordinatedRefresh", () => {
  let bc: {
    postMessage: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    close: () => void;
  };

  beforeEach(async () => {
    // Reset module state so the in-flight cache from one test doesn't leak to the next.
    vi.resetModules();
    bc = {
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      close: () => undefined,
    };
    vi.stubGlobal(
      "BroadcastChannel",
      vi.fn().mockImplementation(() => bc),
    );

    // Default: navigator.locks present and behaves like an honest exclusive lock
    // (sequential, never holds across tests because we resetModules).
    let lockHeld = false;
    const queue: Array<() => void> = [];
    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      locks: {
        request: vi
          .fn()
          .mockImplementation(async (_name: string, _opts: unknown, cb: () => Promise<unknown>) => {
            if (lockHeld) {
              await new Promise<void>((resolve) => queue.push(resolve));
            }
            lockHeld = true;
            try {
              return await cb();
            } finally {
              lockHeld = false;
              const next = queue.shift();
              if (next) next();
            }
          }),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("calls fetcher exactly once when invoked twice in parallel", async () => {
    const { coordinatedRefresh } = await import("./auth-coordinator");
    const fetcher = vi.fn().mockResolvedValue({ kind: "ok", accessToken: "fresh" });
    const [a, b] = await Promise.all([coordinatedRefresh(fetcher), coordinatedRefresh(fetcher)]);
    // Within ONE tab, the module-level promise dedup means fetcher runs once.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a.kind).toBe("ok");
    expect(b.kind).toBe("ok");
  });

  it("falls back gracefully when navigator.locks is undefined", async () => {
    vi.stubGlobal("navigator", { ...globalThis.navigator, locks: undefined });
    const { coordinatedRefresh } = await import("./auth-coordinator");
    const fetcher = vi.fn().mockResolvedValue({ kind: "ok", accessToken: "fresh" });
    const result = await coordinatedRefresh(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe("ok");
  });

  it("broadcasts the result on success", async () => {
    const { coordinatedRefresh } = await import("./auth-coordinator");
    const fetcher = vi.fn().mockResolvedValue({ kind: "ok", accessToken: "fresh" });
    await coordinatedRefresh(fetcher);
    expect(bc.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "ok" }));
  });

  it("broadcasts unauthenticated kind too", async () => {
    const { coordinatedRefresh } = await import("./auth-coordinator");
    const fetcher = vi.fn().mockResolvedValue({ kind: "unauthenticated" });
    await coordinatedRefresh(fetcher);
    expect(bc.postMessage).toHaveBeenCalledWith({ kind: "unauthenticated" });
  });

  it("broadcasts transient with status only (no retryAfterMs)", async () => {
    const { coordinatedRefresh } = await import("./auth-coordinator");
    const fetcher = vi
      .fn()
      .mockResolvedValue({ kind: "transient", status: 429, retryAfterMs: 3000 });
    await coordinatedRefresh(fetcher);
    expect(bc.postMessage).toHaveBeenCalledWith({ kind: "transient", status: 429 });
  });
});

describe("onRefreshBroadcast", () => {
  let bc: {
    postMessage: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    close: () => void;
  };

  beforeEach(() => {
    vi.resetModules();
    bc = {
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      close: () => undefined,
    };
    vi.stubGlobal(
      "BroadcastChannel",
      vi.fn().mockImplementation(() => bc),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("subscribes a listener and the unsubscribe function removes it", async () => {
    const { onRefreshBroadcast } = await import("./auth-coordinator");
    const handler = vi.fn();
    const unsub = onRefreshBroadcast(handler);
    expect(bc.addEventListener).toHaveBeenCalledWith("message", expect.any(Function));
    unsub();
    expect(bc.removeEventListener).toHaveBeenCalledWith("message", expect.any(Function));
  });

  it("returns a no-op unsub when BroadcastChannel is unavailable", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const { onRefreshBroadcast } = await import("./auth-coordinator");
    const handler = vi.fn();
    const unsub = onRefreshBroadcast(handler);
    expect(typeof unsub).toBe("function");
    expect(() => unsub()).not.toThrow();
  });
});
