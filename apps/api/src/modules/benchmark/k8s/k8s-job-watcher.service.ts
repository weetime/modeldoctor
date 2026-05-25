import type { Informer, V1Pod } from "@kubernetes/client-node";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { BenchmarkRepository } from "../benchmark.repository.js";
import { IN_PROGRESS_STATES } from "../constants.js";
import { type DesiredTransition, type ReducerConfig, reduce } from "./pod-state-reducer.js";
import type { StartupReconciler } from "./startup-reconciler.js";

export type WatcherMode = "off" | "backstop" | "primary";

const RUN_ID_LABEL = "modeldoctor.ai/run-id";

export interface WatcherDeps {
  mode: WatcherMode;
  namespace: string;
  reducerConfig: ReducerConfig;
  makeInformer: () => Informer<V1Pod>;
  repo: BenchmarkRepository;
  reconciler: StartupReconciler;
}

@Injectable()
export class K8sJobWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(K8sJobWatcherService.name);
  private informer: Informer<V1Pod> | null = null;
  private readonly firstFatalWaitingAt = new Map<string, Date>();
  private readonly firstTerminalAt = new Map<string, Date>();
  private consecutiveErrors = 0;

  constructor(private readonly deps: WatcherDeps) {}

  async onModuleInit(): Promise<void> {
    if (this.deps.mode === "off") {
      this.log.log("K8S_WATCHER_MODE=off → skipping informer + reconciler");
      return;
    }
    if (this.deps.mode === "primary") {
      throw new Error("K8S_WATCHER_MODE=primary is reserved for Phase 2; not yet implemented");
    }
    this.informer = this.deps.makeInformer();
    this.informer.on("add", (p) => this.handlePodEvent(p));
    this.informer.on("update", (p) => this.handlePodEvent(p));
    this.informer.on("delete", (p) => this.handlePodDelete(p));
    this.informer.on("connect", () => {
      this.consecutiveErrors = 0;
      this.log.log("informer connected");
    });
    this.informer.on("error", (e) => {
      this.consecutiveErrors += 1;
      this.log.warn(
        `informer error (#${this.consecutiveErrors}): ${e instanceof Error ? e.message : String(e)}`,
      );
      // The informer auto-reconnects; we only log. Future: emit ops alert at threshold.
    });
    await this.informer.start();
    this.log.log(`K8s watcher started (mode=backstop, ns=${this.deps.namespace})`);
    await this.deps.reconciler.run();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.informer) {
      try {
        await this.informer.stop();
      } catch (e) {
        this.log.warn(`informer.stop() threw during shutdown: ${(e as Error).message}`);
      }
      this.log.log("K8s watcher stopped");
    }
  }

  private extractRunId(pod: V1Pod): string | null {
    return pod.metadata?.labels?.[RUN_ID_LABEL] ?? null;
  }

  /** Updates in-memory tracking maps based on current pod state. */
  private trackTiming(pod: V1Pod, runId: string, now: Date): void {
    const phase = pod.status?.phase;
    const waitingReason = pod.status?.containerStatuses?.[0]?.state?.waiting?.reason;
    const isFatalWaiting =
      !!waitingReason && this.deps.reducerConfig.fatalWaitingReasons.includes(waitingReason);

    if (isFatalWaiting) {
      if (!this.firstFatalWaitingAt.has(runId)) this.firstFatalWaitingAt.set(runId, now);
    } else {
      this.firstFatalWaitingAt.delete(runId);
    }

    if (phase === "Failed" || phase === "Succeeded") {
      if (!this.firstTerminalAt.has(runId)) this.firstTerminalAt.set(runId, now);
    } else {
      this.firstTerminalAt.delete(runId);
    }
  }

  private async handlePodEvent(pod: V1Pod): Promise<void> {
    const runId = this.extractRunId(pod);
    if (!runId) return;

    let bench: Awaited<ReturnType<BenchmarkRepository["findById"]>>;
    try {
      bench = await this.deps.repo.findById(runId);
    } catch (e) {
      this.log.warn(`findById(${runId}) failed: ${(e as Error).message}`);
      return;
    }
    if (!bench) return;

    const now = new Date();
    this.trackTiming(pod, runId, now);

    const transition = reduce({
      pod,
      currentStatus: bench.status,
      firstFatalWaitingAt: this.firstFatalWaitingAt.get(runId) ?? null,
      firstTerminalAt: this.firstTerminalAt.get(runId) ?? null,
      now,
      config: this.deps.reducerConfig,
    });

    await this.execute(runId, transition, now);
  }

  private handlePodDelete(pod: V1Pod): void {
    const runId = this.extractRunId(pod);
    if (!runId) return;
    this.firstFatalWaitingAt.delete(runId);
    this.firstTerminalAt.delete(runId);
  }

  private async execute(runId: string, t: DesiredTransition, now: Date): Promise<void> {
    if (t.kind === "noop") return;
    try {
      const updated = await this.deps.repo.updateGuarded(runId, IN_PROGRESS_STATES, {
        status: "failed",
        statusMessage: t.message,
        completedAt: now,
      });
      if (!updated) {
        this.log.log(
          `guard rejected update for ${runId} (status already terminal); watcher backed off`,
        );
        return;
      }
      this.log.log(`watcher marked ${runId} failed: ${t.kind}`);
    } catch (e) {
      this.log.warn(`updateGuarded(${runId}) failed: ${(e as Error).message}`);
    }
  }
}
