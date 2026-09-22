import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceWatcherService } from "./source-watcher.service.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("SourceWatcherService", () => {
  let watchCalls: Array<{
    onEvent: () => void;
    d: ReturnType<typeof deferred>;
    signal: AbortSignal;
  }>;
  let sync: { reconcile: ReturnType<typeof vi.fn> };
  let svc: SourceWatcherService;

  beforeEach(() => {
    vi.useFakeTimers();
    watchCalls = [];
    const client = {
      watchModels: vi.fn(({ onEvent, signal }) => {
        const d = deferred();
        watchCalls.push({ onEvent, d, signal });
        signal.addEventListener("abort", () => d.resolve());
        return d.promise;
      }),
    };
    sync = { reconcile: vi.fn(async () => ({})) };
    const sources = {
      listEnabledIds: vi.fn(async () => ["s1"]),
      getDecrypted: vi.fn(async () => ({
        id: "s1",
        baseUrl: "http://gs",
        apiKey: "k",
        enabled: true,
      })),
      onChange: vi.fn(),
    };
    const factory = { create: vi.fn(async () => client) };
    svc = new SourceWatcherService(sources as never, factory as never, sync as never);
  });

  afterEach(async () => {
    await svc.onModuleDestroy();
    vi.useRealTimers();
  });

  it("reconciles on start, then debounces events into one reconcile", async () => {
    svc.start("s1");
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.reconcile).toHaveBeenCalledTimes(1); // 初始对账
    watchCalls[0].onEvent();
    watchCalls[0].onEvent();
    watchCalls[0].onEvent();
    await vi.advanceTimersByTimeAsync(2000);
    expect(sync.reconcile).toHaveBeenCalledTimes(2);
  });

  it("reconnects with backoff after stream error and reconciles again", async () => {
    svc.start("s1");
    await vi.advanceTimersByTimeAsync(0);
    watchCalls[0].d.reject(new Error("boom"));
    await vi.advanceTimersByTimeAsync(999);
    expect(watchCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(watchCalls).toHaveLength(2);
    expect(sync.reconcile).toHaveBeenCalledTimes(2);
  });

  it("stop aborts the stream and prevents reconnect", async () => {
    svc.start("s1");
    await vi.advanceTimersByTimeAsync(0);
    svc.stop("s1");
    expect(watchCalls[0].signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(watchCalls).toHaveLength(1);
    expect(svc.isWatching("s1")).toBe(false);
  });
});
