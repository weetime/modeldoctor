import type { V1Pod } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";
import { BenchmarkReconciler, type ReconcilerDeps } from "./benchmark-reconciler.js";

function podWithRunId(runId: string): V1Pod {
  return {
    metadata: {
      name: `run-${runId}-xyz12`, // Job spawns pods with random suffix
      namespace: "modeldoctor-benchmarks",
      labels: { "modeldoctor.ai/run-id": runId },
    },
    spec: { containers: [{ name: "runner", image: "x" }] },
    status: { phase: "Running" },
  };
}

function makeDeps(
  opts: { livePods?: V1Pod[]; storageExists?: boolean | ((key: string) => Promise<boolean>) } = {},
): {
  deps: ReconcilerDeps;
  repo: { listByStatus: ReturnType<typeof vi.fn>; updateGuarded: ReturnType<typeof vi.fn> };
  listLivePods: ReturnType<typeof vi.fn>;
  storage: {
    exists: ReturnType<typeof vi.fn>;
    readJson: ReturnType<typeof vi.fn>;
    readText: ReturnType<typeof vi.fn>;
    readBytes: ReturnType<typeof vi.fn>;
  };
  reportLoader: { tryLoad: ReturnType<typeof vi.fn> };
} {
  const repo = {
    listByStatus: vi.fn(async () => []),
    updateGuarded: vi.fn(async () => ({ id: "x" })),
  };
  const listLivePods = vi.fn(async () => opts.livePods ?? []);
  const storage = {
    exists: vi.fn(async (k: string) =>
      typeof opts.storageExists === "function"
        ? opts.storageExists(k)
        : (opts.storageExists ?? false),
    ),
    readJson: vi.fn(),
    readText: vi.fn(),
    readBytes: vi.fn(),
  };
  const reportLoader = { tryLoad: vi.fn(async () => {}) };
  return {
    deps: {
      repo: repo as never,
      listLivePods: listLivePods as never,
      storage: storage as never,
      reportLoader: reportLoader as never,
    },
    repo,
    listLivePods,
    storage,
    reportLoader,
  };
}

// A benchmark row old enough to clear any orphan grace window.
function oldRow(id: string, status = "running") {
  return { id, status, createdAt: new Date("2020-01-01T00:00:00Z") };
}

describe("BenchmarkReconciler", () => {
  it("no-op when no IN_PROGRESS benchmarks", async () => {
    const { deps, repo, listLivePods } = makeDeps();
    await new BenchmarkReconciler(deps).run();
    expect(repo.listByStatus).toHaveBeenCalledOnce();
    expect(listLivePods).not.toHaveBeenCalled();
    expect(repo.updateGuarded).not.toHaveBeenCalled();
  });

  it("leaves benchmark alone when a live pod with matching run-id label exists", async () => {
    const { deps, repo, listLivePods } = makeDeps({ livePods: [podWithRunId("abc")] });
    repo.listByStatus.mockResolvedValue([oldRow("abc")]);
    await new BenchmarkReconciler(deps).run();
    expect(listLivePods).toHaveBeenCalledOnce();
    expect(repo.updateGuarded).not.toHaveBeenCalled();
  });

  it("marks failed when no live pod with matching run-id label exists", async () => {
    // A pod exists, but with a DIFFERENT run-id — should NOT save us.
    const { deps, repo } = makeDeps({ livePods: [podWithRunId("someone-else")] });
    repo.listByStatus.mockResolvedValue([oldRow("abc")]);
    await new BenchmarkReconciler(deps).run();
    expect(repo.updateGuarded).toHaveBeenCalledWith(
      "abc",
      ["pending", "submitted", "running"],
      expect.objectContaining({
        status: "failed",
        statusMessage: expect.stringMatching(/pod gone|orphan/i),
      }),
    );
  });

  it("processes multiple benchmarks independently using label-based lookup", async () => {
    // Only pod for "b" is live. "a" and "c" are orphans.
    const { deps, repo } = makeDeps({ livePods: [podWithRunId("b")] });
    repo.listByStatus.mockResolvedValue([oldRow("a"), oldRow("b", "submitted"), oldRow("c")]);
    await new BenchmarkReconciler(deps).run();
    expect(repo.updateGuarded).toHaveBeenCalledTimes(2);
    expect(repo.updateGuarded).toHaveBeenCalledWith("a", expect.any(Array), expect.any(Object));
    expect(repo.updateGuarded).toHaveBeenCalledWith("c", expect.any(Array), expect.any(Object));
  });

  it("lists live pods only once across many benchmarks", async () => {
    const { deps, repo, listLivePods } = makeDeps({ livePods: [] });
    repo.listByStatus.mockResolvedValue([oldRow("a"), oldRow("b"), oldRow("c")]);
    await new BenchmarkReconciler(deps).run();
    expect(listLivePods).toHaveBeenCalledOnce();
  });

  it("storage has result.json → calls reportLoader.tryLoad and skips pod check", async () => {
    const { deps, repo, listLivePods, storage, reportLoader } = makeDeps({ storageExists: true });
    repo.listByStatus.mockResolvedValueOnce([oldRow("r1")]);

    await new BenchmarkReconciler(deps).run();

    expect(storage.exists).toHaveBeenCalledWith("r1/result.json");
    expect(reportLoader.tryLoad).toHaveBeenCalledWith("r1");
    // Should NOT fall through to pod check or updateGuarded
    expect(listLivePods).not.toHaveBeenCalled();
    expect(repo.updateGuarded).not.toHaveBeenCalled();
  });

  it("storage.exists throws → logs + falls back to pod check", async () => {
    const { deps, repo, listLivePods, storage, reportLoader } = makeDeps({
      storageExists: async () => {
        throw new Error("s3 down");
      },
    });
    repo.listByStatus.mockResolvedValueOnce([oldRow("r1")]);

    await new BenchmarkReconciler(deps).run();

    expect(storage.exists).toHaveBeenCalledOnce();
    expect(reportLoader.tryLoad).not.toHaveBeenCalled();
    // Falls back: pod check fires; runId not live → updateGuarded(failed)
    expect(listLivePods).toHaveBeenCalled();
    expect(repo.updateGuarded).toHaveBeenCalledWith(
      "r1",
      expect.anything(),
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("result.json exists but tryLoad throws → logs, does NOT orphan-fail or pod-check", async () => {
    const { deps, repo, listLivePods, reportLoader } = makeDeps({ storageExists: true });
    repo.listByStatus.mockResolvedValue([oldRow("r1")]);
    reportLoader.tryLoad.mockRejectedValueOnce(new Error("findById blew up"));

    await new BenchmarkReconciler(deps).run();

    expect(reportLoader.tryLoad).toHaveBeenCalledWith("r1");
    // Must NOT fall through to the pod check / orphan path.
    expect(listLivePods).not.toHaveBeenCalled();
    expect(repo.updateGuarded).not.toHaveBeenCalled();
  });

  it("one benchmark's updateGuarded throwing does not skip the rest", async () => {
    const { deps, repo } = makeDeps({ livePods: [] }); // both are orphans
    repo.listByStatus.mockResolvedValue([oldRow("a"), oldRow("b")]);
    repo.updateGuarded
      .mockRejectedValueOnce(new Error("db blip")) // a fails
      .mockResolvedValueOnce({ id: "b" }); // b still attempted

    await new BenchmarkReconciler(deps).run();

    expect(repo.updateGuarded).toHaveBeenCalledTimes(2);
    expect(repo.updateGuarded).toHaveBeenCalledWith("b", expect.anything(), expect.anything());
  });

  it("listLivePods throwing aborts the sweep (never orphan-fails on a K8s outage)", async () => {
    const { deps, repo, listLivePods } = makeDeps();
    listLivePods.mockRejectedValueOnce(new Error("k8s api down"));
    repo.listByStatus.mockResolvedValue([oldRow("a")]);

    await expect(new BenchmarkReconciler(deps).run()).rejects.toThrow("k8s api down");
    expect(repo.updateGuarded).not.toHaveBeenCalled();
  });

  describe("orphan grace window (periodic mode)", () => {
    it("does NOT orphan-fail a run younger than orphanMinAgeMs", async () => {
      const { deps, repo } = makeDeps({ livePods: [] });
      // Created just now → younger than the 60s grace.
      repo.listByStatus.mockResolvedValue([
        { id: "fresh", status: "submitted", createdAt: new Date() },
      ]);
      await new BenchmarkReconciler(deps).run({ orphanMinAgeMs: 60_000 });
      expect(repo.updateGuarded).not.toHaveBeenCalled();
    });

    it("orphan-fails a run older than orphanMinAgeMs", async () => {
      const { deps, repo } = makeDeps({ livePods: [] });
      repo.listByStatus.mockResolvedValue([oldRow("stale", "submitted")]);
      await new BenchmarkReconciler(deps).run({ orphanMinAgeMs: 60_000 });
      expect(repo.updateGuarded).toHaveBeenCalledWith(
        "stale",
        expect.anything(),
        expect.objectContaining({ status: "failed" }),
      );
    });

    it("orphanMinAgeMs=0 (startup default) ignores age entirely", async () => {
      const { deps, repo } = makeDeps({ livePods: [] });
      repo.listByStatus.mockResolvedValue([
        { id: "fresh", status: "submitted", createdAt: new Date() },
      ]);
      await new BenchmarkReconciler(deps).run();
      expect(repo.updateGuarded).toHaveBeenCalledWith(
        "fresh",
        expect.anything(),
        expect.objectContaining({ status: "failed" }),
      );
    });
  });
});
