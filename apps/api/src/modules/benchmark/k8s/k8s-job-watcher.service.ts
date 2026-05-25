import type { Informer, V1Pod } from "@kubernetes/client-node";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { BenchmarkRepository } from "../benchmark.repository.js";
import type { ReducerConfig } from "./pod-state-reducer.js";
import type { StartupReconciler } from "./startup-reconciler.js";

export type WatcherMode = "off" | "backstop" | "primary";

export interface WatcherDeps {
  mode: WatcherMode;
  namespace: string;
  reducerConfig: ReducerConfig;
  /** Factory so callers can inject a fake in tests without touching K8s. */
  makeInformer: () => Informer<V1Pod>;
  repo: BenchmarkRepository;
  reconciler: StartupReconciler;
}

@Injectable()
export class K8sJobWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(K8sJobWatcherService.name);
  private informer: Informer<V1Pod> | null = null;
  /** runId → earliest moment this pod was observed in a FATAL waiting state. */
  private readonly firstFatalWaitingAt = new Map<string, Date>();
  /** runId → earliest moment this pod was observed in a terminal phase. */
  private readonly firstTerminalAt = new Map<string, Date>();

  constructor(private readonly deps: WatcherDeps) {}

  async onModuleInit(): Promise<void> {
    if (this.deps.mode === "off") {
      this.log.log("K8S_WATCHER_MODE=off → skipping informer + reconciler");
      return;
    }
    if (this.deps.mode === "primary") {
      throw new Error("K8S_WATCHER_MODE=primary is reserved for Phase 2; not yet implemented");
    }
    // mode === "backstop"
    this.informer = this.deps.makeInformer();
    // Handlers wired in Task 5
    await this.informer.start();
    this.log.log(`K8s watcher started (mode=backstop, ns=${this.deps.namespace})`);
    await this.deps.reconciler.run();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.informer) {
      await this.informer.stop();
      this.log.log("K8s watcher stopped");
    }
  }
}
