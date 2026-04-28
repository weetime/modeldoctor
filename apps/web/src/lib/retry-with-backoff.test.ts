import { afterEach, describe, expect, it, vi } from "vitest";
import { retryWithBackoff } from "./retry-with-backoff";

describe("retryWithBackoff", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns immediately on non-transient first try", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retryWithBackoff(fn, () => false, {
      maxAttempts: 3,
      baseMs: 1,
      factor: 2,
      jitter: () => 0,
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries up to maxAttempts then returns last result", async () => {
    const fn = vi.fn().mockResolvedValue("transient");
    const result = await retryWithBackoff(fn, () => ({ retryAfterMs: 0 }), {
      maxAttempts: 3,
      baseMs: 1,
      factor: 2,
      jitter: () => 0,
    });
    expect(result).toBe("transient");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("honors retryAfterMs as a floor", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => (calls++ === 0 ? "transient" : "ok"));
    const start = Date.now();
    await retryWithBackoff(fn, (r) => (r === "transient" ? { retryAfterMs: 50 } : false), {
      maxAttempts: 3,
      baseMs: 1,
      factor: 1,
      jitter: () => 0,
    });
    expect(Date.now() - start).toBeGreaterThanOrEqual(40); // some scheduler slack
  });
});
