import type { ObjectCache, V1Pod } from "@kubernetes/client-node";
import { Injectable, Logger } from "@nestjs/common";
import { IN_PROGRESS_STATES } from "../constants.js";
import type { BenchmarkRepository } from "../benchmark.repository.js";

const RUN_ID_LABEL = "modeldoctor.ai/run-id";
const MAX_RECONCILE_ROWS = 500;

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
    if (inProgress.length === MAX_RECONCILE_ROWS) {
      // Hit the listByStatus cap — there may be more IN_PROGRESS benchmarks
      // that we silently dropped. Surface this so ops knows to investigate.
      this.log.warn(
        `reconcile: listByStatus hit the ${MAX_RECONCILE_ROWS}-row cap; ` +
          `additional IN_PROGRESS benchmarks may be unreconciled`,
      );
    }
    this.log.log(`reconcile: ${inProgress.length} IN_PROGRESS benchmark(s) to check`);

    // Build a Set of runIds whose pod is present in the informer cache. We
    // can't use ObjectCache.get(name, ns) because K8s appends a random suffix
    // to Job-spawned pods (run-<id>-<5-char-suffix>), so exact-name lookup
    // misses every actual pod. Filter by label instead.
    const livePodRunIds = new Set<string>();
    for (const pod of this.deps.podCache.list(this.deps.namespace)) {
      const runId = pod.metadata?.labels?.[RUN_ID_LABEL];
      if (runId) livePodRunIds.add(runId);
    }

    for (const b of inProgress) {
      if (livePodRunIds.has(b.id)) {
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
