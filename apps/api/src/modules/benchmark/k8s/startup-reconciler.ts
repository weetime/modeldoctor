import type { ObjectCache, V1Pod } from "@kubernetes/client-node";
import { Injectable, Logger } from "@nestjs/common";
import { IN_PROGRESS_STATES } from "../constants.js";
import type { BenchmarkRepository } from "../benchmark.repository.js";

export interface ReconcilerDeps {
  namespace: string;
  repo: BenchmarkRepository;
  podCache: ObjectCache<V1Pod>;
}

@Injectable()
export class StartupReconciler {
  private readonly log = new Logger(StartupReconciler.name);

  constructor(private readonly deps: ReconcilerDeps) {}

  async run(): Promise<void> {
    const inProgress = await this.deps.repo.listByStatus(IN_PROGRESS_STATES);
    if (inProgress.length === 0) {
      this.log.log("reconcile: no IN_PROGRESS benchmarks");
      return;
    }
    this.log.log(`reconcile: ${inProgress.length} IN_PROGRESS benchmark(s) to check`);

    for (const b of inProgress) {
      const podName = `run-${b.id}`;
      const pod = this.deps.podCache.get(podName, this.deps.namespace);
      if (pod) {
        // Informer will deliver events for this pod; nothing to do here.
        continue;
      }
      // Phase 1 scope: no storage yet, so any orphan IN_PROGRESS → failed.
      // Phase 2 will check storage first (report file may exist even if pod is gone).
      const updated = await this.deps.repo.updateGuarded(b.id, IN_PROGRESS_STATES, {
        status: "failed",
        statusMessage: "pod gone before reconcile",
        completedAt: new Date(),
      });
      if (updated) {
        this.log.log(`reconcile: marked ${b.id} failed (orphan)`);
      }
    }
  }
}
