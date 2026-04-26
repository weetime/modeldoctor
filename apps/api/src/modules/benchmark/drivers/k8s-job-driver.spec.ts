import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BenchmarkExecutionContext } from "./execution-driver.interface.js";
import { K8sJobDriver } from "./k8s-job-driver.js";

const ctx: BenchmarkExecutionContext = {
  benchmarkId: "ckabc",
  profile: "throughput",
  apiType: "chat",
  apiUrl: "https://t",
  apiKey: "sk",
  model: "m",
  datasetName: "random",
  datasetInputTokens: 128,
  datasetOutputTokens: 128,
  datasetSeed: undefined,
  requestRate: 0,
  totalRequests: 10,
  maxDurationSeconds: 60,
  callbackUrl: "http://api:3001",
  callbackToken: "tok",
};

interface FakeApis {
  batch: {
    createNamespacedJob: ReturnType<typeof vi.fn>;
    deleteNamespacedJob: ReturnType<typeof vi.fn>;
    readNamespacedJob: ReturnType<typeof vi.fn>;
  };
  core: {
    createNamespacedSecret: ReturnType<typeof vi.fn>;
    deleteNamespacedSecret: ReturnType<typeof vi.fn>;
    patchNamespacedSecret: ReturnType<typeof vi.fn>;
    listNamespacedPod: ReturnType<typeof vi.fn>;
  };
}

function buildApis(): FakeApis {
  return {
    batch: {
      createNamespacedJob: vi.fn(),
      deleteNamespacedJob: vi.fn(),
      readNamespacedJob: vi.fn(),
    },
    core: {
      createNamespacedSecret: vi.fn(),
      deleteNamespacedSecret: vi.fn(),
      patchNamespacedSecret: vi.fn(),
      listNamespacedPod: vi.fn(),
    },
  };
}

describe("K8sJobDriver", () => {
  let apis: FakeApis;
  beforeEach(() => {
    apis = buildApis();
  });
  afterEach(() => vi.restoreAllMocks());

  describe("start", () => {
    it("creates Secret before Job, then patches ownerReferences", async () => {
      const order: string[] = [];
      apis.core.createNamespacedSecret.mockImplementation(async () => {
        order.push("secret");
      });
      apis.batch.createNamespacedJob.mockImplementation(async () => {
        order.push("job");
        return { body: { metadata: { uid: "job-uid-1" } } };
      });
      apis.core.patchNamespacedSecret.mockImplementation(async () => {
        order.push("patch");
      });

      const drv = new K8sJobDriver({
        namespace: "modeldoctor-benchmarks",
        image: "img:tag",
        apis: apis as unknown as ConstructorParameters<typeof K8sJobDriver>[0]["apis"],
      });
      const { handle } = await drv.start(ctx);
      expect(order).toEqual(["secret", "job", "patch"]);
      expect(handle).toBe("modeldoctor-benchmarks/benchmark-ckabc");

      const patchArgs = apis.core.patchNamespacedSecret.mock.calls[0];
      expect(patchArgs[0]).toBe("benchmark-ckabc"); // name
      expect(patchArgs[1]).toBe("modeldoctor-benchmarks"); // ns
      // The patch body must include ownerReferences with the Job uid.
      const patchBody = patchArgs[2];
      expect(JSON.stringify(patchBody)).toContain("job-uid-1");
    });

    it("does not put apiKey or callbackToken into the Job's env.value", async () => {
      apis.batch.createNamespacedJob.mockResolvedValue({
        body: { metadata: { uid: "u" } },
      });
      const drv = new K8sJobDriver({
        namespace: "ns",
        image: "img:tag",
        apis: apis as never,
      });
      await drv.start(ctx);
      const jobBody = apis.batch.createNamespacedJob.mock.calls[0][1];
      const envEntries = jobBody.spec.template.spec.containers[0].env ?? [];
      const envText = JSON.stringify(envEntries);
      expect(envText).not.toContain("sk"); // apiKey value
      expect(envText).not.toContain("tok"); // callbackToken value
    });

    it("rolls back the Secret when Job creation fails", async () => {
      apis.batch.createNamespacedJob.mockRejectedValue(new Error("rbac denied"));
      const drv = new K8sJobDriver({
        namespace: "ns",
        image: "img:tag",
        apis: apis as never,
      });
      await expect(drv.start(ctx)).rejects.toThrow(/rbac denied/);
      expect(apis.core.deleteNamespacedSecret).toHaveBeenCalledWith("benchmark-ckabc", "ns");
    });

    it("tolerates a failing ownerReference patch (warns, doesn't abort)", async () => {
      apis.batch.createNamespacedJob.mockResolvedValue({
        body: { metadata: { uid: "u" } },
      });
      apis.core.patchNamespacedSecret.mockRejectedValue(new Error("patch failed"));
      const drv = new K8sJobDriver({
        namespace: "ns",
        image: "img:tag",
        apis: apis as never,
      });
      const { handle } = await drv.start(ctx);
      expect(handle).toBe("ns/benchmark-ckabc");
    });
  });

  describe("cancel", () => {
    it("deletes the Job with foreground propagation", async () => {
      const drv = new K8sJobDriver({
        namespace: "ns",
        image: "img:tag",
        apis: apis as never,
      });
      apis.batch.deleteNamespacedJob.mockResolvedValue({});
      await drv.cancel("ns/benchmark-ckabc");
      const args = apis.batch.deleteNamespacedJob.mock.calls[0];
      expect(args[0]).toBe("benchmark-ckabc"); // name
      expect(args[1]).toBe("ns"); // ns
      // 7th positional arg is propagationPolicy in @kubernetes/client-node 0.21.
      expect(args).toContain("Foreground");
    });

    it("treats 404 as silent ok", async () => {
      const err = new Error("not found") as Error & { statusCode: number };
      err.statusCode = 404;
      apis.batch.deleteNamespacedJob.mockRejectedValue(err);
      const drv = new K8sJobDriver({
        namespace: "ns",
        image: "img:tag",
        apis: apis as never,
      });
      await expect(drv.cancel("ns/benchmark-ckabc")).resolves.toBeUndefined();
    });

    it("rejects malformed handles", async () => {
      const drv = new K8sJobDriver({
        namespace: "ns",
        image: "img:tag",
        apis: apis as never,
      });
      await expect(drv.cancel("not-a-handle")).rejects.toThrow(/handle/);
    });
  });

  it("cleanup is a no-op (TTL handles GC)", async () => {
    const drv = new K8sJobDriver({
      namespace: "ns",
      image: "img:tag",
      apis: apis as never,
    });
    await expect(drv.cleanup("ns/benchmark-ckabc")).resolves.toBeUndefined();
    expect(apis.batch.deleteNamespacedJob).not.toHaveBeenCalled();
  });
});
