import type { V1Pod } from "@kubernetes/client-node";
import { reportStorageKeys } from "@modeldoctor/contracts";
import { Injectable, Logger } from "@nestjs/common";
import type { BenchmarkRepository } from "../benchmark.repository.js";
import { IN_PROGRESS_STATES } from "../constants.js";
import type { ReportLoader } from "../storage/report-loader.js";
import type { ReportStorage } from "../storage/report-storage.js";

const RUN_ID_LABEL = "modeldoctor.ai/run-id";
const MAX_RECONCILE_ROWS = 500;

export interface ReconcilerDeps {
  repo: BenchmarkRepository;
  /**
   * Fresh, authoritative list of benchmark pods from the K8s API (NOT the
   * informer cache). Using a live list is what lets the periodic reconcile act
   * as a real safety net: if the informer has silently died, its cache is stale,
   * and trusting it would wrongly orphan-fail still-running benchmarks. A live
   * list is also strictly more correct at startup, before the informer's own
   * initial LIST has populated its cache.
   */
  listLivePods: () => Promise<V1Pod[]>;
  storage: ReportStorage;
  reportLoader: ReportLoader;
}

export interface ReconcileOptions {
  /**
   * Minimum age (ms) a benchmark must have before the orphan path
   * (no live pod + no result.json → failed) may fire. Guards against the race
   * where a just-submitted benchmark's Job/pod hasn't been created yet. 0 = no
   * guard (startup: rows are already old relative to a fresh boot).
   */
  orphanMinAgeMs?: number;
}

/**
 * Reconciles IN_PROGRESS benchmarks against ground truth (S3 result.json +
 * live K8s pods). Runs both once at boot (catch up on anything missed while the
 * API was down) and periodically as a safety net behind the informer — the
 * informer is the primary status driver, but @kubernetes/client-node's informer
 * stops on any non-410 watch error, so a periodic sweep guarantees runs still
 * resolve even if the watch stream is wedged.
 */
@Injectable()
export class BenchmarkReconciler {
  private readonly log = new Logger(BenchmarkReconciler.name);

  constructor(private readonly deps: ReconcilerDeps) {}

  async run(opts: ReconcileOptions = {}): Promise<void> {
    const orphanMinAgeMs = opts.orphanMinAgeMs ?? 0;
    const inProgress = await this.deps.repo.listByStatus(IN_PROGRESS_STATES);
    if (inProgress.length === 0) {
      this.log.debug("reconcile: no IN_PROGRESS benchmarks");
      return;
    }
    if (inProgress.length === MAX_RECONCILE_ROWS) {
      // Hit the listByStatus cap — there may be more IN_PROGRESS benchmarks
      // that we silently dropped. Surface this so ops knows to investigate.
      this.log.warn(
        `reconcile: listByStatus hit the ${MAX_RECONCILE_ROWS}-row cap; additional IN_PROGRESS benchmarks may be unreconciled`,
      );
    }
    this.log.debug(`reconcile: ${inProgress.length} IN_PROGRESS benchmark(s) to check`);

    // Build the live-pod set lazily — only on the first benchmark that reaches
    // the pod-presence fallback. If every benchmark has result.json in storage,
    // the K8s API is never queried at all.
    // We can't match by exact pod name because K8s appends a random suffix to
    // Job-spawned pods (run-<id>-<5-char-suffix>); filter by run-id label instead.
    let liveRunIds: Set<string> | null = null;
    const getLiveRunIds = async (): Promise<Set<string>> => {
      if (liveRunIds === null) {
        liveRunIds = new Set<string>();
        for (const pod of await this.deps.listLivePods()) {
          const runId = pod.metadata?.labels?.[RUN_ID_LABEL];
          if (runId) liveRunIds.add(runId);
        }
      }
      return liveRunIds;
    };

    const now = Date.now();
    for (const b of inProgress) {
      // 1. Storage is ground truth — if the runner finished writing result.json
      //    (pod Succeeded) but we missed the informer event, reload from storage.
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

      // 2. No result yet — is a pod still live for this run?
      if ((await getLiveRunIds()).has(b.id)) {
        // Pod is running; informer (or a later reconcile) will resolve it.
        continue;
      }

      // 3. No live pod and no result. Before declaring it orphaned, honor the
      //    grace window so a just-submitted run whose pod isn't created yet
      //    isn't killed out from under the scheduler.
      if (orphanMinAgeMs > 0) {
        const ageMs = now - new Date(b.createdAt).getTime();
        if (ageMs < orphanMinAgeMs) {
          this.log.debug(
            `reconcile: ${b.id} has no pod yet (age ${Math.round(ageMs / 1000)}s < grace); skipping orphan check`,
          );
          continue;
        }
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
