import type { ToolName } from "@modeldoctor/tool-adapters";
import { describe, expect, it, vi } from "vitest";
import { PodLogStreamerPool } from "./pod-log-streamer-pool.js";

function makePool() {
  const probeRbac = vi.fn(async () => undefined);
  const repo = { update: vi.fn(async () => undefined) };
  const streamerInstances: Array<{
    run: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
    drainOrTimeout: ReturnType<typeof vi.fn>;
    runResolve: () => void;
  }> = [];
  const factory = {
    repo,
    probeRbac,
    create: vi.fn(() => {
      let runResolve!: () => void;
      const runPromise = new Promise<void>((r) => {
        runResolve = r;
      });
      const instance = {
        run: vi.fn(() => runPromise),
        abort: vi.fn(() => runResolve()),
        drainOrTimeout: vi.fn(async () => {
          runResolve();
        }),
        runResolve,
      };
      streamerInstances.push(instance);
      return instance;
    }),
  };
  const pool = new PodLogStreamerPool(factory as never);
  return { pool, factory, probeRbac, streamerInstances };
}

describe("PodLogStreamerPool", () => {
  it("start is idempotent — second call for the same runId is a no-op", () => {
    const { pool, factory } = makePool();
    pool.start("r1", "pod-r1", "guidellm" as ToolName);
    pool.start("r1", "pod-r1", "guidellm" as ToolName);
    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(pool.has("r1")).toBe(true);
  });

  it("stop force-aborts and removes from map", () => {
    const { pool, streamerInstances } = makePool();
    pool.start("r1", "pod-r1", "guidellm" as ToolName);
    pool.stop("r1");
    expect(streamerInstances[0].abort).toHaveBeenCalled();
    expect(pool.has("r1")).toBe(false);
  });

  it("stop is a no-op when runId not present", () => {
    const { pool } = makePool();
    expect(() => pool.stop("missing")).not.toThrow();
  });

  it("drainAndStop calls drainOrTimeout then removes from map", async () => {
    const { pool, streamerInstances } = makePool();
    pool.start("r1", "pod-r1", "guidellm" as ToolName);
    await pool.drainAndStop("r1", 5000);
    expect(streamerInstances[0].drainOrTimeout).toHaveBeenCalledWith(5000);
    expect(pool.has("r1")).toBe(false);
  });

  it("onModuleInit invokes probeRbac", async () => {
    const { pool, probeRbac } = makePool();
    await pool.onModuleInit();
    expect(probeRbac).toHaveBeenCalledTimes(1);
  });

  it("onModuleDestroy aborts all streamers and clears map", async () => {
    const { pool, streamerInstances } = makePool();
    pool.start("r1", "pod-r1", "guidellm" as ToolName);
    pool.start("r2", "pod-r2", "vegeta" as ToolName);
    await pool.onModuleDestroy();
    expect(streamerInstances[0].abort).toHaveBeenCalled();
    expect(streamerInstances[1].abort).toHaveBeenCalled();
    expect(pool.has("r1")).toBe(false);
    expect(pool.has("r2")).toBe(false);
  });
});
