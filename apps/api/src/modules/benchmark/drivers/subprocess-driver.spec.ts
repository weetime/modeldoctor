import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BenchmarkExecutionContext } from "./execution-driver.interface.js";

// Mock node:child_process before importing the driver.
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { SubprocessDriver } from "./subprocess-driver.js";

const baseCtx: BenchmarkExecutionContext = {
  benchmarkId: "ckabc",
  profile: "latency",
  apiType: "chat",
  apiBaseUrl: "https://api.example.com",
  apiKey: "sk-secret",
  model: "m1",
  datasetName: "random",
  datasetInputTokens: 128,
  datasetOutputTokens: 128,
  datasetSeed: undefined,
  requestRate: 1,
  totalRequests: 100,
  maxDurationSeconds: 600,
  callbackUrl: "http://localhost:3001",
  callbackToken: "tok",
  validateBackend: true,
  maxConcurrency: 100,
};

function fakeChild(pid: number): ChildProcess {
  const ee = new EventEmitter() as ChildProcess;
  Object.assign(ee, { pid, kill: vi.fn(() => true), killed: false });
  return ee;
}

describe("SubprocessDriver", () => {
  beforeEach(() => spawnMock.mockReset());
  afterEach(() => vi.useRealTimers());

  it("spawns benchmark-runner with the right argv (no secrets in argv)", async () => {
    const child = fakeChild(4242);
    spawnMock.mockReturnValue(child);

    const drv = new SubprocessDriver();
    const { handle } = await drv.start(baseCtx);

    expect(handle).toBe("subprocess:4242");
    const [cmd, args, opts] = spawnMock.mock.calls[0];
    expect(cmd).toBe("benchmark-runner");
    expect(args).toContain("benchmark");
    expect(args).toContain("run");
    // argv must NOT contain the api key.
    expect(args.join(" ")).not.toContain("sk-secret");
    expect(args.join(" ")).not.toContain("tok");
    // env must carry the secrets.
    expect(opts.env.API_KEY).toBe("sk-secret");
    expect(opts.env.CALLBACK_TOKEN).toBe("tok");
    expect(opts.env.BENCHMARK_ID).toBe("ckabc");
    expect(opts.env.CALLBACK_URL).toBe("http://localhost:3001");
    expect(opts.detached).toBeFalsy();
  });

  it("cancel() sends SIGTERM, then SIGKILL after 10s if still alive", async () => {
    vi.useFakeTimers();
    const child = fakeChild(99);
    spawnMock.mockReturnValue(child);

    const drv = new SubprocessDriver();
    const { handle } = await drv.start(baseCtx);
    await drv.cancel(handle);

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    vi.advanceTimersByTime(10_001);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("cancel() of an unknown handle is silent ok (post-restart case)", async () => {
    const drv = new SubprocessDriver();
    await expect(drv.cancel("subprocess:404")).resolves.toBeUndefined();
  });

  it("cleanup() removes the handle from the in-memory map", async () => {
    const child = fakeChild(7);
    spawnMock.mockReturnValue(child);

    const drv = new SubprocessDriver();
    const { handle } = await drv.start(baseCtx);
    await drv.cleanup(handle);
    // After cleanup, cancel should be a silent no-op.
    await expect(drv.cancel(handle)).resolves.toBeUndefined();
    // And the SIGTERM kill must NOT have been called by cancel after cleanup.
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("auto-removes the handle when the child exits", async () => {
    const child = fakeChild(8);
    spawnMock.mockReturnValue(child);

    const drv = new SubprocessDriver();
    const { handle } = await drv.start(baseCtx);
    child.emit("exit", 0, null);
    // After exit, cancel of that handle is a no-op.
    await expect(drv.cancel(handle)).resolves.toBeUndefined();
    expect(child.kill).not.toHaveBeenCalled();
  });
});
