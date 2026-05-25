import { beforeEach, describe, expect, it, vi } from "vitest";
import { StartupReconciler, type ReconcilerDeps } from "./startup-reconciler.js";

function makeDeps(): {
  deps: ReconcilerDeps;
  repo: {
    listByStatus: ReturnType<typeof vi.fn>;
    updateGuarded: ReturnType<typeof vi.fn>;
  };
  cache: { get: ReturnType<typeof vi.fn> };
} {
  const repo = {
    listByStatus: vi.fn(async () => []),
    updateGuarded: vi.fn(async () => ({ id: "x" })),
  };
  const cache = { get: vi.fn(() => undefined) };
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
    const { deps, repo } = makeDeps();
    await new StartupReconciler(deps).run();
    expect(repo.listByStatus).toHaveBeenCalledOnce();
    expect(repo.updateGuarded).not.toHaveBeenCalled();
  });

  it("leaves benchmarks alone when matching pod exists (informer will handle)", async () => {
    const { deps, repo, cache } = makeDeps();
    repo.listByStatus.mockResolvedValue([{ id: "abc", status: "running" }]);
    cache.get.mockReturnValue({
      metadata: { name: "run-abc", labels: { "modeldoctor.ai/run-id": "abc" } },
      status: { phase: "Running" },
    });
    await new StartupReconciler(deps).run();
    expect(repo.updateGuarded).not.toHaveBeenCalled();
  });

  it("marks failed when pod is gone (orphan)", async () => {
    const { deps, repo, cache } = makeDeps();
    repo.listByStatus.mockResolvedValue([{ id: "abc", status: "running" }]);
    cache.get.mockReturnValue(undefined);
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

  it("processes multiple benchmarks independently", async () => {
    const { deps, repo, cache } = makeDeps();
    repo.listByStatus.mockResolvedValue([
      { id: "a", status: "running" },
      { id: "b", status: "submitted" },
      { id: "c", status: "running" },
    ]);
    cache.get.mockImplementation((name: string) => {
      if (name === "run-b") return { metadata: { labels: {} }, status: { phase: "Running" } };
      return undefined;
    });
    await new StartupReconciler(deps).run();
    expect(repo.updateGuarded).toHaveBeenCalledTimes(2);
    expect(repo.updateGuarded).toHaveBeenCalledWith("a", expect.any(Array), expect.any(Object));
    expect(repo.updateGuarded).toHaveBeenCalledWith("c", expect.any(Array), expect.any(Object));
  });
});
