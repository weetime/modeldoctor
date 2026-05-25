import type { Informer, V1Pod } from "@kubernetes/client-node";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
