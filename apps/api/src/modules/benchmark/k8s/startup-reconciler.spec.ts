import type { V1Pod } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";
import { type ReconcilerDeps, StartupReconciler } from "./startup-reconciler.js";

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

function makeDeps(podsInCache: V1Pod[] = []): {
  deps: ReconcilerDeps;
  repo: {
    listByStatus: ReturnType<typeof vi.fn>;
    updateGuarded: ReturnType<typeof vi.fn>;
  };
  cache: { list: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
} {
  const repo = {
    listByStatus: vi.fn(async () => []),
    updateGuarded: vi.fn(async () => ({ id: "x" })),
  };
  const cache = {
    list: vi.fn(() => podsInCache),
    get: vi.fn(() => undefined),
  };
  return {
    deps: {
      namespace: "modeldoctor-benchmarks",
      repo: repo as never,
      podCache: cache as never,
    },
    repo,
    cache,
  };
}

describe("StartupReconciler", () => {
  it("no-op when no IN_PROGRESS benchmarks", async () => {
    const { deps, repo, cache } = makeDeps();
    await new StartupReconciler(deps).run();
    expect(repo.listByStatus).toHaveBeenCalledOnce();
    expect(cache.list).not.toHaveBeenCalled();
    expect(repo.updateGuarded).not.toHaveBeenCalled();
  });

  it("leaves benchmark alone when a pod with matching run-id label exists", async () => {
    const { deps, repo, cache } = makeDeps([podWithRunId("abc")]);
    repo.listByStatus.mockResolvedValue([{ id: "abc", status: "running" }]);
    await new StartupReconciler(deps).run();
    expect(cache.list).toHaveBeenCalledWith("modeldoctor-benchmarks");
    expect(repo.updateGuarded).not.toHaveBeenCalled();
  });

  it("marks failed when no pod with matching run-id label is in the cache", async () => {
    // Cache contains a pod, but with a DIFFERENT run-id — should NOT save us.
    const { deps, repo } = makeDeps([podWithRunId("someone-else")]);
    repo.listByStatus.mockResolvedValue([{ id: "abc", status: "running" }]);
    await new StartupReconciler(deps).run();
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
    // Cache contains only pod for "b". "a" and "c" are orphans.
    const { deps, repo } = makeDeps([podWithRunId("b")]);
    repo.listByStatus.mockResolvedValue([
      { id: "a", status: "running" },
      { id: "b", status: "submitted" },
      { id: "c", status: "running" },
    ]);
    await new StartupReconciler(deps).run();
    expect(repo.updateGuarded).toHaveBeenCalledTimes(2);
    expect(repo.updateGuarded).toHaveBeenCalledWith("a", expect.any(Array), expect.any(Object));
    expect(repo.updateGuarded).toHaveBeenCalledWith("c", expect.any(Array), expect.any(Object));
  });
});
