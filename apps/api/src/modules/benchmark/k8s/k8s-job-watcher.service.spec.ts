import type { Informer, V1Pod } from "@kubernetes/client-node";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { podFailed, podPendingWaiting, podRunId, podSucceeded } from "./__fixtures__/pod-fixtures.js";
import { K8sJobWatcherService, type WatcherDeps } from "./k8s-job-watcher.service.js";

function makeFakeInformer() {
  const handlers = new Map<string, Array<(arg: unknown) => void>>();
  const informer: Informer<V1Pod> & {
    fire: (verb: string, payload: unknown) => void;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  } = {
    on: vi.fn((verb: string, cb: (arg: unknown) => void) => {
      if (!handlers.has(verb)) handlers.set(verb, []);
      handlers.get(verb)!.push(cb);
    }),
    off: vi.fn(),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    fire: (verb: string, payload: unknown) => {
      handlers.get(verb)?.forEach((cb) => cb(payload));
    },
  } as unknown as Informer<V1Pod> & {
    fire: (verb: string, payload: unknown) => void;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  return informer;
}

function makeDeps(mode: "off" | "backstop" = "backstop"): {
  deps: WatcherDeps;
  informer: ReturnType<typeof makeFakeInformer>;
  repo: { findById: ReturnType<typeof vi.fn>; updateGuarded: ReturnType<typeof vi.fn> };
  reconciler: { run: ReturnType<typeof vi.fn> };
} {
  const informer = makeFakeInformer();
  const repo = {
    findById: vi.fn(async () => null),
    updateGuarded: vi.fn(async () => null),
  };
  const reconciler = { run: vi.fn(async () => undefined) };
  return {
    deps: {
      mode,
      namespace: "modeldoctor-benchmarks",
      reducerConfig: {
        fatalWaitingReasons: ["ImagePullBackOff"],
        waitingFatalGraceSec: 60,
        terminalReconcileGraceSec: 60,
      },
      makeInformer: () => informer as unknown as Informer<V1Pod>,
      repo: repo as never,
      reconciler: reconciler as never,
    },
    informer,
    repo,
    reconciler,
  };
}

describe("K8sJobWatcherService", () => {
  describe("mode=off", () => {
    it("does NOT start informer or run reconciler on init", async () => {
      const { deps, informer, reconciler } = makeDeps("off");
      const svc = new K8sJobWatcherService(deps);
      await svc.onModuleInit();
      expect(informer.start).not.toHaveBeenCalled();
      expect(reconciler.run).not.toHaveBeenCalled();
    });
  });

  describe("mode=backstop", () => {
    it("starts informer + runs reconciler on init", async () => {
      const { deps, informer, reconciler } = makeDeps("backstop");
      const svc = new K8sJobWatcherService(deps);
      await svc.onModuleInit();
      expect(informer.start).toHaveBeenCalledOnce();
      expect(reconciler.run).toHaveBeenCalledOnce();
    });

    it("stops informer on destroy", async () => {
      const { deps, informer } = makeDeps("backstop");
      const svc = new K8sJobWatcherService(deps);
      await svc.onModuleInit();
      await svc.onModuleDestroy();
      expect(informer.stop).toHaveBeenCalledOnce();
    });

    it("is destroy-safe when init never ran", async () => {
      const { deps, informer } = makeDeps("backstop");
      const svc = new K8sJobWatcherService(deps);
      await svc.onModuleDestroy();
      expect(informer.stop).not.toHaveBeenCalled();
    });
  });
});

describe("K8sJobWatcherService event handling", () => {
  it("ADD with FATAL waiting → starts tracking + no immediate update", async () => {
    const { deps, informer, repo } = makeDeps("backstop");
    repo.findById.mockResolvedValue({ id: podRunId(), status: "submitted" });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();

    informer.fire("add", podPendingWaiting("ImagePullBackOff"));
    // grace not elapsed → no update
    await new Promise((r) => setTimeout(r, 5));
    expect(repo.updateGuarded).not.toHaveBeenCalled();
  });

  it("UPDATE after grace with FATAL waiting → updateGuarded(failed)", async () => {
    const { deps, informer, repo } = makeDeps("backstop");
    repo.findById.mockResolvedValue({ id: podRunId(), status: "submitted" });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    // simulate earlier observation by injecting state
    (svc as unknown as { firstFatalWaitingAt: Map<string, Date> }).firstFatalWaitingAt.set(
      podRunId(),
      new Date(Date.now() - 120_000),
    );

    informer.fire("update", podPendingWaiting("ImagePullBackOff", "boom"));
    await new Promise((r) => setTimeout(r, 5));
    expect(repo.updateGuarded).toHaveBeenCalledWith(
      podRunId(),
      ["pending", "submitted", "running"],
      expect.objectContaining({
        status: "failed",
        statusMessage: expect.stringContaining("ImagePullBackOff"),
      }),
    );
  });

  it("UPDATE with non-fatal waiting clears firstFatalWaitingAt", async () => {
    const { deps, informer, repo } = makeDeps("backstop");
    repo.findById.mockResolvedValue({ id: podRunId(), status: "submitted" });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    const state = svc as unknown as { firstFatalWaitingAt: Map<string, Date> };
    state.firstFatalWaitingAt.set(podRunId(), new Date());

    informer.fire("update", podPendingWaiting("ContainerCreating"));
    await new Promise((r) => setTimeout(r, 5));
    expect(state.firstFatalWaitingAt.has(podRunId())).toBe(false);
  });

  it("UPDATE with Succeeded pod after grace + IN_PROGRESS → failed-terminal", async () => {
    const { deps, informer, repo } = makeDeps("backstop");
    repo.findById.mockResolvedValue({ id: podRunId(), status: "running" });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    (svc as unknown as { firstTerminalAt: Map<string, Date> }).firstTerminalAt.set(
      podRunId(),
      new Date(Date.now() - 120_000),
    );

    informer.fire("update", podSucceeded());
    await new Promise((r) => setTimeout(r, 5));
    expect(repo.updateGuarded).toHaveBeenCalledWith(
      podRunId(),
      ["pending", "submitted", "running"],
      expect.objectContaining({
        status: "failed",
        statusMessage: expect.stringMatching(/no callback|never arrived/i),
      }),
    );
  });

  it("DELETE clears in-memory state for the runId", async () => {
    const { deps, informer } = makeDeps("backstop");
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    const state = svc as unknown as {
      firstFatalWaitingAt: Map<string, Date>;
      firstTerminalAt: Map<string, Date>;
    };
    state.firstFatalWaitingAt.set(podRunId(), new Date());
    state.firstTerminalAt.set(podRunId(), new Date());

    informer.fire("delete", podFailed());
    await new Promise((r) => setTimeout(r, 5));
    expect(state.firstFatalWaitingAt.has(podRunId())).toBe(false);
    expect(state.firstTerminalAt.has(podRunId())).toBe(false);
  });

  it("ignores pods without modeldoctor.ai/run-id label", async () => {
    const { deps, informer, repo } = makeDeps("backstop");
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    informer.fire("add", {
      metadata: { name: "rogue", namespace: "x", labels: {} },
      status: { phase: "Running" },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it("ignores benchmarks already in terminal state", async () => {
    const { deps, informer, repo } = makeDeps("backstop");
    repo.findById.mockResolvedValue({ id: podRunId(), status: "completed" });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    (svc as unknown as { firstTerminalAt: Map<string, Date> }).firstTerminalAt.set(
      podRunId(),
      new Date(Date.now() - 120_000),
    );
    informer.fire("update", podSucceeded());
    await new Promise((r) => setTimeout(r, 5));
    expect(repo.updateGuarded).not.toHaveBeenCalled();
  });
});
