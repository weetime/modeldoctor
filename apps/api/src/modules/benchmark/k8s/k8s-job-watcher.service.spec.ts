import type { Informer, V1Pod } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";
import {
  podFailed,
  podPendingWaiting,
  podRunId,
  podRunning,
  podSucceeded,
} from "./__fixtures__/pod-fixtures.js";
import {
  K8sJobWatcherService,
  type WatcherDeps,
  type WatcherMode,
} from "./k8s-job-watcher.service.js";

function makeFakeInformer() {
  const handlers = new Map<string, Array<(arg: unknown) => void>>();
  const informer: Informer<V1Pod> & {
    fire: (verb: string, payload: unknown) => void;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  } = {
    on: vi.fn((verb: string, cb: (arg: unknown) => void) => {
      if (!handlers.has(verb)) handlers.set(verb, []);
      handlers.get(verb)?.push(cb);
    }),
    off: vi.fn(),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    fire: (verb: string, payload: unknown) => {
      for (const cb of handlers.get(verb) ?? []) cb(payload);
    },
  } as unknown as Informer<V1Pod> & {
    fire: (verb: string, payload: unknown) => void;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  return informer;
}

function makeDeps(
  mode: WatcherMode = "primary",
  overrides: Partial<WatcherDeps> = {},
): {
  deps: WatcherDeps;
  informer: ReturnType<typeof makeFakeInformer>;
  repo: { findById: ReturnType<typeof vi.fn>; updateGuarded: ReturnType<typeof vi.fn> };
  reconciler: { run: ReturnType<typeof vi.fn> };
  reportLoader: { tryLoad: ReturnType<typeof vi.fn> };
  pool: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    drainAndStop: ReturnType<typeof vi.fn>;
    has: ReturnType<typeof vi.fn>;
  };
} {
  const informer = makeFakeInformer();
  const repo = {
    findById: vi.fn(async () => null),
    updateGuarded: vi.fn(async () => null),
  };
  const reconciler = { run: vi.fn(async () => undefined) };
  const reportLoader = { tryLoad: vi.fn(async () => {}) };
  const pool = {
    start: vi.fn(),
    stop: vi.fn(),
    drainAndStop: vi.fn(async () => {}),
    has: vi.fn(() => false),
  };
  return {
    deps: {
      mode,
      namespace: "modeldoctor-benchmarks",
      reducerConfig: {
        fatalWaitingReasons: ["ImagePullBackOff"],
        waitingFatalGraceSec: 60,
      },
      makeInformer: () => informer as unknown as Informer<V1Pod>,
      repo: repo as never,
      reconciler: reconciler as never,
      reportLoader: reportLoader as never,
      pool: pool as never,
      // Periodic sweep off by default so lifecycle tests see exactly one
      // reconciler.run() (the startup call); 0-delay backoff makes restart
      // deterministic across a single macrotask.
      reconcileIntervalMs: 0,
      orphanMinAgeMs: 60_000,
      backoffMs: () => 0,
      ...overrides,
    },
    informer,
    repo,
    reconciler,
    reportLoader,
    pool,
  };
}

describe("K8sJobWatcherService — lifecycle", () => {
  it("mode=off does NOT start informer or run reconciler", async () => {
    const { deps, informer, reconciler } = makeDeps("off");
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    expect(informer.start).not.toHaveBeenCalled();
    expect(reconciler.run).not.toHaveBeenCalled();
  });

  it("mode=primary starts informer + runs reconciler on init", async () => {
    const { deps, informer, reconciler } = makeDeps("primary");
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    expect(informer.start).toHaveBeenCalledOnce();
    expect(reconciler.run).toHaveBeenCalledOnce();
  });

  it("stops informer on destroy", async () => {
    const { deps, informer } = makeDeps("primary");
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    await svc.onModuleDestroy();
    expect(informer.stop).toHaveBeenCalledOnce();
  });

  it("is destroy-safe when init never ran", async () => {
    const { deps, informer } = makeDeps("primary");
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleDestroy();
    expect(informer.stop).not.toHaveBeenCalled();
  });
});

describe("K8sJobWatcherService — informer resilience", () => {
  it("restarts the informer after a non-410 watch error", async () => {
    const { deps, informer } = makeDeps("primary");
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    expect(informer.start).toHaveBeenCalledOnce(); // initial start

    informer.fire("error", new Error("ECONNRESET"));
    await new Promise((r) => setTimeout(r, 5)); // let the 0-delay restart timer fire

    expect(informer.start).toHaveBeenCalledTimes(2); // restarted
  });

  it("does NOT restart the informer once destroyed (stopped)", async () => {
    const { deps, informer } = makeDeps("primary");
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    await svc.onModuleDestroy();
    informer.start.mockClear();

    informer.fire("error", new Error("late error during shutdown"));
    await new Promise((r) => setTimeout(r, 5));

    expect(informer.start).not.toHaveBeenCalled();
  });

  it("keeps retrying when a restart attempt itself fails", async () => {
    const { deps, informer } = makeDeps("primary");
    informer.start
      .mockResolvedValueOnce(undefined) // init
      .mockRejectedValueOnce(new Error("list failed")) // first restart fails
      .mockResolvedValue(undefined); // retry succeeds
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();

    informer.fire("error", new Error("ECONNRESET"));
    await new Promise((r) => setTimeout(r, 20)); // failed restart + reschedule + retry

    // init + failed restart + successful retry
    expect(informer.start.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

describe("K8sJobWatcherService — periodic reconcile", () => {
  it("does not schedule a periodic sweep when interval is 0", async () => {
    const { deps, reconciler } = makeDeps("primary", { reconcileIntervalMs: 0 });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    await new Promise((r) => setTimeout(r, 20));
    await svc.onModuleDestroy();
    expect(reconciler.run).toHaveBeenCalledOnce(); // only the startup run
  });

  it("runs a periodic reconcile with orphanMinAgeMs when interval > 0", async () => {
    const { deps, reconciler } = makeDeps("primary", {
      reconcileIntervalMs: 10,
      orphanMinAgeMs: 60_000,
    });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    await new Promise((r) => setTimeout(r, 35)); // ~3 ticks
    await svc.onModuleDestroy();

    expect(reconciler.run.mock.calls.length).toBeGreaterThan(1);
    // startup run() takes no args; periodic runs pass the orphan grace
    expect(reconciler.run).toHaveBeenCalledWith({ orphanMinAgeMs: 60_000 });
  });

  it("does not overlap: skips a tick while the previous reconcile is in flight", async () => {
    const { deps, reconciler } = makeDeps("primary", { reconcileIntervalMs: 10 });
    // startup run() resolves immediately; the first periodic run() (called with
    // opts) hangs, so every later tick must be skipped by the isReconciling lock.
    let releasePeriodic: () => void = () => {};
    const periodicGate = new Promise<void>((res) => {
      releasePeriodic = res;
    });
    reconciler.run.mockImplementation((opts?: unknown) =>
      opts ? periodicGate : Promise.resolve(undefined),
    );

    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    await new Promise((r) => setTimeout(r, 45)); // ~4 ticks would fire without the lock

    // startup(1) + exactly one in-flight periodic(1); all later ticks skipped.
    expect(reconciler.run).toHaveBeenCalledTimes(2);

    releasePeriodic();
    await svc.onModuleDestroy();
  });
});

describe("K8sJobWatcherService event handling", () => {
  it("ADD with FATAL waiting → starts tracking + no immediate update", async () => {
    const { deps, informer, repo } = makeDeps("primary");
    repo.findById.mockResolvedValue({ id: podRunId(), status: "submitted" });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();

    informer.fire("add", podPendingWaiting("ImagePullBackOff"));
    // grace not elapsed → no update
    await new Promise((r) => setTimeout(r, 5));
    expect(repo.updateGuarded).not.toHaveBeenCalled();
  });

  it("UPDATE after grace with FATAL waiting → updateGuarded(failed)", async () => {
    const { deps, informer, repo } = makeDeps("primary");
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
    const { deps, informer, repo } = makeDeps("primary");
    repo.findById.mockResolvedValue({ id: podRunId(), status: "submitted" });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    const state = svc as unknown as { firstFatalWaitingAt: Map<string, Date> };
    state.firstFatalWaitingAt.set(podRunId(), new Date());

    informer.fire("update", podPendingWaiting("ContainerCreating"));
    await new Promise((r) => setTimeout(r, 5));
    expect(state.firstFatalWaitingAt.has(podRunId())).toBe(false);
  });

  it("DELETE clears in-memory state for the runId", async () => {
    const { deps, informer } = makeDeps("primary");
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    const state = svc as unknown as { firstFatalWaitingAt: Map<string, Date> };
    state.firstFatalWaitingAt.set(podRunId(), new Date());

    informer.fire("delete", podFailed());
    await new Promise((r) => setTimeout(r, 5));
    expect(state.firstFatalWaitingAt.has(podRunId())).toBe(false);
  });

  it("ignores pods without modeldoctor.ai/run-id label", async () => {
    const { deps, informer, repo } = makeDeps("primary");
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
    const { deps, informer, repo } = makeDeps("primary");
    repo.findById.mockResolvedValue({ id: podRunId(), status: "completed" });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    informer.fire("update", podSucceeded());
    await new Promise((r) => setTimeout(r, 5));
    expect(repo.updateGuarded).not.toHaveBeenCalled();
  });
});

describe("K8sJobWatcherService — reduce → execute branches", () => {
  it("Succeeded pod → reportLoader.tryLoad called with runId", async () => {
    const { deps, informer, repo, reportLoader } = makeDeps("primary");
    repo.findById.mockResolvedValue({ id: podRunId(), status: "running" });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();

    informer.fire("update", podSucceeded());
    await new Promise((r) => setTimeout(r, 5));

    expect(reportLoader.tryLoad).toHaveBeenCalledOnce();
    expect(reportLoader.tryLoad).toHaveBeenCalledWith(podRunId());
    expect(repo.updateGuarded).not.toHaveBeenCalled();
  });

  it("Running ready pod + status=submitted → updateGuarded(['submitted'], { status: 'running' })", async () => {
    const { deps, informer, repo } = makeDeps("primary");
    repo.findById.mockResolvedValue({ id: podRunId(), status: "submitted" });
    repo.updateGuarded.mockResolvedValue({ id: podRunId() });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();

    informer.fire("update", podRunning());
    await new Promise((r) => setTimeout(r, 5));

    expect(repo.updateGuarded).toHaveBeenCalledWith(
      podRunId(),
      ["submitted"],
      expect.objectContaining({ status: "running", startedAt: expect.any(Date) }),
    );
  });

  it("Failed pod → updateGuarded(IN_PROGRESS_STATES, { status: 'failed' }) immediately (no grace)", async () => {
    const { deps, informer, repo } = makeDeps("primary");
    repo.findById.mockResolvedValue({ id: podRunId(), status: "running" });
    repo.updateGuarded.mockResolvedValue({ id: podRunId() });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();

    informer.fire("update", podFailed(1, "Error", "tool exit 1"));
    await new Promise((r) => setTimeout(r, 5));

    expect(repo.updateGuarded).toHaveBeenCalledWith(
      podRunId(),
      ["pending", "submitted", "running"],
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("Failed pod on a resumable tool (tau3) → defers to reconciler, no updateGuarded", async () => {
    const { deps, informer, repo } = makeDeps("primary");
    repo.findById.mockResolvedValue({ id: podRunId(), status: "running", tool: "tau3" });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();

    informer.fire("update", podFailed(1, "Error", "tool exit 1"));
    await new Promise((r) => setTimeout(r, 5));

    expect(repo.updateGuarded).not.toHaveBeenCalled();
  });
});

describe("Phase 3 — pod log streamer", () => {
  it("Running ready pod + status=submitted calls pool.start", async () => {
    const { deps, informer, repo, pool } = makeDeps("primary");
    repo.findById.mockResolvedValue({ id: podRunId(), status: "submitted", tool: "guidellm" });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    informer.fire("add", podRunning());
    await new Promise((r) => setImmediate(r));
    expect(pool.start).toHaveBeenCalledWith(podRunId(), expect.any(String), "guidellm");
  });

  it("Succeeded pod calls pool.drainAndStop(5000) before reportLoader.tryLoad", async () => {
    const { deps, informer, repo, pool, reportLoader } = makeDeps("primary");
    repo.findById.mockResolvedValue({ id: podRunId(), status: "running", tool: "guidellm" });
    const callOrder: string[] = [];
    pool.drainAndStop.mockImplementation(async () => {
      callOrder.push("drain");
    });
    reportLoader.tryLoad.mockImplementation(async () => {
      callOrder.push("tryLoad");
    });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    informer.fire("update", podSucceeded());
    await new Promise((r) => setImmediate(r));
    expect(pool.drainAndStop).toHaveBeenCalledWith(podRunId(), 5000);
    expect(callOrder).toEqual(["drain", "tryLoad"]);
  });

  it("Failed pod calls pool.drainAndStop(0) before repo.updateGuarded", async () => {
    const { deps, informer, repo, pool } = makeDeps("primary");
    repo.findById.mockResolvedValue({ id: podRunId(), status: "running", tool: "guidellm" });
    const callOrder: string[] = [];
    pool.drainAndStop.mockImplementation(async () => {
      callOrder.push("drain");
    });
    repo.updateGuarded.mockImplementation(async () => {
      callOrder.push("update");
      return { id: podRunId() } as never;
    });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    informer.fire("update", podFailed());
    await new Promise((r) => setImmediate(r));
    expect(pool.drainAndStop).toHaveBeenCalledWith(podRunId(), 0);
    expect(callOrder).toEqual(["drain", "update"]);
  });

  it("pod delete event calls pool.stop", async () => {
    const { deps, informer, pool } = makeDeps("primary");
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    informer.fire("delete", podRunning());
    expect(pool.stop).toHaveBeenCalledWith(podRunId());
  });
});
