import type { ObjectCache, V1Pod } from "@kubernetes/client-node";
import { reportStorageKeys } from "@modeldoctor/contracts";
import { Injectable, Logger } from "@nestjs/common";
import type { BenchmarkRepository } from "../benchmark.repository.js";
import { IN_PROGRESS_STATES } from "../constants.js";
import type { ReportLoader } from "../storage/report-loader.js";
import type { ReportStorage } from "../storage/report-storage.js";

const RUN_ID_LABEL = "modeldoctor.ai/run-id";
const MAX_RECONCILE_ROWS = 500;

export interface ReconcilerDeps {
  namespace: string;
  repo: BenchmarkRepository;
  podCache: ObjectCache<V1Pod>;
  storage: ReportStorage;
  reportLoader: ReportLoader;
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
        `reconcile: listByStatus hit the ${MAX_RECONCILE_ROWS}-row cap; additional IN_PROGRESS benchmarks may be unreconciled`,
      );
    }
    this.log.log(`reconcile: ${inProgress.length} IN_PROGRESS benchmark(s) to check`);

    // Build the live-pod set lazily — only on the first benchmark that reaches
    // the pod-cache fallback. If every benchmark has result.json in storage,
    // the informer cache is never queried at all.
    // We can't use ObjectCache.get(name, ns) because K8s appends a random suffix
    // to Job-spawned pods (run-<id>-<5-char-suffix>), so exact-name lookup
    // misses every actual pod. Filter by label instead.
    let livePodRunIds: Set<string> | null = null;
    const getLivePodRunIds = (): Set<string> => {
      if (livePodRunIds === null) {
        livePodRunIds = new Set<string>();
        for (const pod of this.deps.podCache.list(this.deps.namespace)) {
          const runId = pod.metadata?.labels?.[RUN_ID_LABEL];
          if (runId) livePodRunIds.add(runId);
        }
      }
      return livePodRunIds;
    };

    for (const b of inProgress) {
      // 1. Storage is ground truth — if runner finished writing result.json
      //    before pod TTL'd away (long downtime), reload from storage.
      const resultKey = reportStorageKeys(b.id).result;
      try {
        if (await this.deps.storage.exists(resultKey)) {
          this.log.log(`reconcile: ${b.id} has result.json → loading report`);
          await this.deps.reportLoader.tryLoad(b.id);
          continue;
        }
      } catch (e) {
        this.log.warn(
          `reconcile: storage.exists(${b.id}) failed: ${(e as Error).message}; falling back to pod check`,
        );
      }

      // 2. Storage was empty (or storage.exists threw); fall back to pod-presence check.
      if (getLivePodRunIds().has(b.id)) {
        // Informer will deliver events for this pod; nothing to do here.
        continue;
      }
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
