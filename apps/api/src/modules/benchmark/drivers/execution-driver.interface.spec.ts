import { describe, expect, it } from "vitest";
import type {
  BenchmarkExecutionContext,
  BenchmarkExecutionDriver,
  BenchmarkExecutionHandle,
} from "./execution-driver.interface.js";

// Compile-time assertion that the interface shape is what consumers expect.
// This file's primary value is the type-check: if a Phase 3 PR breaks the
// interface, this spec stops compiling.
class NoopDriver implements BenchmarkExecutionDriver {
  async start(_ctx: BenchmarkExecutionContext): Promise<{ handle: BenchmarkExecutionHandle }> {
    return { handle: "noop:0" };
  }
  async cancel(_handle: BenchmarkExecutionHandle): Promise<void> {
    /* no-op */
  }
  async cleanup(_handle: BenchmarkExecutionHandle): Promise<void> {
    /* no-op */
  }
}

describe("BenchmarkExecutionDriver interface", () => {
  it("is implementable by a noop driver", async () => {
    const d: BenchmarkExecutionDriver = new NoopDriver();
    const { handle } = await d.start({
      benchmarkId: "ckxxx",
      profile: "throughput",
      apiType: "chat",
      apiUrl: "http://target",
      apiKey: "sk-test",
      model: "facebook/opt-125m",
      datasetName: "random",
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      requestRate: 0,
      totalRequests: 1000,
      maxDurationSeconds: 1800,
      callbackUrl: "http://api:3001",
      callbackToken: "hmac-token",
      validateBackend: true,
      maxConcurrency: 100,
    });
    expect(handle).toBe("noop:0");
    await expect(d.cancel(handle)).resolves.toBeUndefined();
    await expect(d.cancel(handle)).resolves.toBeUndefined(); // idempotent
    await expect(d.cleanup(handle)).resolves.toBeUndefined();
    await expect(d.cleanup(handle)).resolves.toBeUndefined(); // idempotent
  });
});
