import { describe, expect, it, vi } from "vitest";
import { K8sJobDriver } from "./k8s-job-driver.js";
import type { RunExecutionContext } from "./execution-driver.interface.js";

const ctx: RunExecutionContext = {
  runId: "abc",
  tool: "guidellm",
  buildResult: {
    argv: ["echo", "hi"],
    env: {},
    secretEnv: { API_KEY: "k" },
    outputFiles: { report: "report.json" },
  },
  callback: { url: "http://api/", token: "tk" },
  image: "img:latest",
};

function mkDriver() {
  const batch = {
    createNamespacedJob: vi.fn(async () => ({ body: { metadata: { uid: "uid-1" } } })),
    deleteNamespacedJob: vi.fn(async () => ({})),
  };
  const core = {
    createNamespacedSecret: vi.fn(async () => ({})),
    deleteNamespacedSecret: vi.fn(async () => ({})),
    patchNamespacedSecret: vi.fn(async () => ({})),
  };
  const driver = new K8sJobDriver({
    namespace: "ns",
    apis: { batch: batch as never, core: core as never },
  });
  return { driver, batch, core };
}

describe("K8sJobDriver", () => {
  it("creates Secret then Job", async () => {
    const { driver, batch, core } = mkDriver();
    const { handle } = await driver.start(ctx);
    expect(handle).toBe("ns/run-abc");
    expect(core.createNamespacedSecret).toHaveBeenCalled();
    expect(batch.createNamespacedJob).toHaveBeenCalled();
    // Order matters
    expect(core.createNamespacedSecret.mock.invocationCallOrder[0]).toBeLessThan(
      batch.createNamespacedJob.mock.invocationCallOrder[0],
    );
  });

  it("rolls back Secret if Job creation fails", async () => {
    const { driver, batch, core } = mkDriver();
    batch.createNamespacedJob = vi.fn(async () => {
      throw new Error("simulated job-create failure");
    }) as never;
    await expect(driver.start(ctx)).rejects.toThrow(/simulated/);
    expect(core.deleteNamespacedSecret).toHaveBeenCalled();
  });
});
