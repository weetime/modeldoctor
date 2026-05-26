import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProgressThrottle } from "./progress-throttle.js";

function makeRepo() {
  return { update: vi.fn(async () => undefined) };
}

/** Flush microtasks. We use Promise.resolve() chains (not setImmediate)
 *  because vi.useFakeTimers() also fakes setImmediate, which would hang. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("ProgressThrottle", () => {
  beforeEach(() => {
    // Defensive: ensure real timers at the start of every test, even if a
    // previous test crashed before its useRealTimers().
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes the first tick immediately (lastWriteAt=0)", async () => {
    const repo = makeRepo();
    const clock = vi.fn(() => 1_000);
    const throttle = new ProgressThrottle("r1", repo as never, 1000, clock);
    throttle.tick(0.1);
    await flushMicrotasks();
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith("r1", { progress: 0.1 });
  });

  it("coalesces successive ticks inside the window into one trailing write", async () => {
    const repo = makeRepo();
    let now = 1_000;
    const clock = () => now;
    vi.useFakeTimers();
    try {
      const throttle = new ProgressThrottle("r1", repo as never, 1000, clock);
      throttle.tick(0.1);
      await flushMicrotasks();
      expect(repo.update).toHaveBeenCalledTimes(1);
      // Inside window: should defer
      now = 1_200;
      throttle.tick(0.2);
      now = 1_500;
      throttle.tick(0.3);
      now = 1_800;
      throttle.tick(0.4);
      expect(repo.update).toHaveBeenCalledTimes(1);
      // Timer fires at lastWriteAt+windowMs = 2000
      now = 2_000;
      await vi.advanceTimersByTimeAsync(1000);
      expect(repo.update).toHaveBeenCalledTimes(2);
      expect(repo.update).toHaveBeenLastCalledWith("r1", { progress: 0.4 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushNow drains pending and clears timer", async () => {
    const repo = makeRepo();
    let now = 1_000;
    const throttle = new ProgressThrottle("r1", repo as never, 1000, () => now);
    throttle.tick(0.1);
    await flushMicrotasks();
    now = 1_500;
    throttle.tick(0.5);
    await throttle.flushNow();
    expect(repo.update).toHaveBeenCalledTimes(2);
    expect(repo.update).toHaveBeenLastCalledWith("r1", { progress: 0.5 });
  });

  it("flushNow with no pending is a no-op", async () => {
    const repo = makeRepo();
    const throttle = new ProgressThrottle("r1", repo as never, 1000, () => 1_000);
    await throttle.flushNow();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("swallows repo.update errors (progress is best-effort)", async () => {
    const repo = {
      update: vi.fn(async () => {
        throw new Error("db down");
      }),
    };
    const throttle = new ProgressThrottle("r1", repo as never, 1000, () => 1_000);
    throttle.tick(0.1);
    await flushMicrotasks();
    expect(repo.update).toHaveBeenCalledTimes(1);
  });
});
