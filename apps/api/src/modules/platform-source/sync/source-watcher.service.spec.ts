import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKOFF_MAX_MS, SourceWatcherService } from "./source-watcher.service.js";

interface Src {
  id: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
}

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

  it("a stale loop suspended mid-connect never reconciles or calls watchModels after stop()+start() replaces it", async () => {
    const pending: Array<(v: Src) => void> = [];
    const sources = {
      listEnabledIds: vi.fn(async () => ["s1"]),
      getDecrypted: vi.fn(() => new Promise<Src>((resolve) => pending.push(resolve))),
      onChange: vi.fn(),
    };
    const factory = {
      create: vi.fn(async () => ({ watchModels: vi.fn(() => new Promise<void>(() => {})) })),
    };
    const local = new SourceWatcherService(sources as never, factory as never, sync as never);

    local.start("s1");
    await vi.advanceTimersByTimeAsync(0); // loop #1 suspended awaiting its getDecrypted

    // Simulate an upsert mid-connect: stop() aborts + evicts state #1, start() installs state #2.
    local.stop("s1");
    local.start("s1");
    await vi.advanceTimersByTimeAsync(0); // loop #2 suspended awaiting its own getDecrypted
    expect(pending).toHaveLength(2);

    // Resolve the CURRENT (second) invocation first — it should reconcile and watch normally.
    pending[1]({ id: "s1", baseUrl: "http://gs", apiKey: "k", enabled: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(factory.create as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(sync.reconcile).toHaveBeenCalledTimes(1);

    // Now resolve the STALE (first) invocation, which was suspended before stop() ran.
    // It must observe it is no longer current and bail out — no extra connect, no extra reconcile.
    pending[0]({ id: "s1", baseUrl: "http://gs", apiKey: "k", enabled: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(sync.reconcile).toHaveBeenCalledTimes(1);
    // Map/isWatching state is exactly what the newest start() left behind.
    expect(local.isWatching("s1")).toBe(true);

    await local.onModuleDestroy();
  });

  it("a disabled source ends up not watched and schedules no retry", async () => {
    const sources = {
      listEnabledIds: vi.fn(async () => ["s1"]),
      getDecrypted: vi.fn(async () => ({
        id: "s1",
        baseUrl: "http://gs",
        apiKey: "k",
        enabled: false,
      })),
      onChange: vi.fn(),
    };
    const client = { watchModels: vi.fn() };
    const factory = { create: vi.fn(async () => client) };
    const local = new SourceWatcherService(sources as never, factory as never, sync as never);

    local.start("s1");
    await vi.advanceTimersByTimeAsync(0);

    expect(local.isWatching("s1")).toBe(false);
    expect(client.watchModels).not.toHaveBeenCalled();
    expect(sync.reconcile).not.toHaveBeenCalled();

    // No retry was ever scheduled — advancing well past the max backoff changes nothing.
    await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS * 2);
    expect(local.isWatching("s1")).toBe(false);
    expect(client.watchModels).not.toHaveBeenCalled();

    await local.onModuleDestroy();
  });
});
