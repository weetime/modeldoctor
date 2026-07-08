import type { V1Pod } from "@kubernetes/client-node";
import { reportStorageKeys } from "@modeldoctor/contracts";
import { Injectable, Logger } from "@nestjs/common";
import type { BenchmarkRepository } from "../benchmark.repository.js";
import { IN_PROGRESS_STATES } from "../constants.js";
import { isResumable } from "../resumable.js";
import type { ReportLoader } from "../storage/report-loader.js";
import type { ReportStorage } from "../storage/report-storage.js";
import { getRunnerStatus } from "./runner-container.js";

const RUN_ID_LABEL = "modeldoctor.ai/run-id";
const MAX_RECONCILE_ROWS = 500;

/** Phases where the pod is still doing work — a later reconcile will resolve it. */
const NON_TERMINAL_PHASES = new Set(["Pending", "Running", "Unknown"]);

/** Short failure message from the runner container's terminated state. */
function podFailureMessage(pod: V1Pod): string {
  const term = getRunnerStatus(pod)?.state?.terminated;
  if (term) {
    const parts: string[] = [];
    if (term.reason) parts.push(term.reason);
    if (typeof term.exitCode === "number") parts.push(`exit ${term.exitCode}`);
    if (term.message) parts.push(term.message);
    return `pod failed: ${parts.join(" ") || "unknown"}`;
  }
  return `pod failed (phase=${pod.status?.phase ?? "unknown"})`;
}

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
    let podsByRun: Map<string, V1Pod> | null = null;
    const getPodsByRun = async (): Promise<Map<string, V1Pod>> => {
      if (podsByRun === null) {
        podsByRun = new Map<string, V1Pod>();
        for (const pod of await this.deps.listLivePods()) {
          const runId = pod.metadata?.labels?.[RUN_ID_LABEL];
          if (runId) podsByRun.set(runId, pod);
        }
      }
      return podsByRun;
    };

    const now = Date.now();
    for (const b of inProgress) {
      // 1. Storage is ground truth — if the runner finished writing result.json
      //    (pod Succeeded) but we missed the informer event, reload from storage.
      //    Only a storage.exists FAILURE may fall through to the pod check; a
      //    tryLoad failure must NOT — result.json exists, so the pod is gone by
      //    design, and falling through would wrongly orphan-fail a succeeded run.
      const resultKey = reportStorageKeys(b.id).result;
      let hasResult = false;
      try {
        hasResult = await this.deps.storage.exists(resultKey);
      } catch (e) {
        this.log.warn(
          `reconcile: storage.exists(${b.id}) failed: ${(e as Error).message}; falling back to pod check`,
        );
      }
      if (hasResult) {
        try {
          this.log.log(`reconcile: ${b.id} has result.json → loading report`);
          await this.deps.reportLoader.tryLoad(b.id);
        } catch (e) {
          // tryLoad owns its own failure→DB write; an unexpected throw here is
          // logged and we move on — never fall through to the orphan path.
          this.log.warn(`reconcile: tryLoad(${b.id}) threw: ${(e as Error).message}`);
        }
        continue;
      }

      // 2. No result yet — inspect the pod's phase. This call is OUTSIDE the
      //    per-benchmark try/catch on purpose: if the K8s API is unreachable we
      //    must abort the whole sweep rather than orphan-fail running jobs.
      //    In poll mode there's no informer, so the reconciler must drive
      //    terminal-pod transitions itself (a Failed pod lingers until its TTL,
      //    so "pod present" alone must NOT be read as "still running").
      const pod = (await getPodsByRun()).get(b.id);
      if (pod) {
        const phase = pod.status?.phase;
        if (!phase || NON_TERMINAL_PHASES.has(phase)) {
          // Still in flight; informer (or a later reconcile) will resolve it.
          continue;
        }
        // Terminal pod but no result.json: drive to failed (or interrupted if
        // the run is resumable — the caller can resume from checkpoint rather
        // than starting over). (Succeeded-without-result means the runner
        // exited 0 without writing a report — also a failure for our purposes.)
        try {
          const msg =
            phase === "Succeeded"
              ? "pod succeeded but no result.json written"
              : podFailureMessage(pod);
          const status = isResumable(b.tool) ? "interrupted" : "failed";
          const updated = await this.deps.repo.updateGuarded(
            b.id,
            IN_PROGRESS_STATES,
            status === "interrupted"
              ? { status, statusMessage: msg }
              : { status, statusMessage: msg, completedAt: new Date() },
          );
          if (updated) this.log.log(`reconcile: marked ${b.id} ${status} (pod ${phase}): ${msg}`);
        } catch (e) {
          this.log.warn(`reconcile: updateGuarded(${b.id}) threw: ${(e as Error).message}`);
        }
        continue;
      }

      try {
        // 3. No live pod and no result. Before declaring it orphaned, honor the
        //    grace window so a just-submitted run whose pod isn't created yet
        //    isn't killed out from under the scheduler.
        if (orphanMinAgeMs > 0) {
          // Anchor on the LATER of createdAt/startedAt: resume() flips an
          // hours-old row back to pending/submitted and re-submits a Job for
          // the SAME runId, so createdAt alone is stale the instant the row
          // is claimed — a periodic reconcile landing in the gap before the
          // new pod exists would otherwise see a long-expired grace and
          // re-orphan a run that's actually just (re)starting. startedAt is
          // set on every (re)submit (start()/resume()'s CAS patch), so it's
          // fresh exactly when createdAt isn't.
          const anchor = Math.max(
            new Date(b.createdAt).getTime(),
            b.startedAt ? new Date(b.startedAt).getTime() : 0,
          );
          const ageMs = now - anchor;
          if (ageMs < orphanMinAgeMs) {
            this.log.debug(
              `reconcile: ${b.id} has no pod yet (age ${Math.round(ageMs / 1000)}s < grace); skipping orphan check`,
            );
            continue;
          }
        }

        const status = isResumable(b.tool) ? "interrupted" : "failed";
        const updated = await this.deps.repo.updateGuarded(
          b.id,
          IN_PROGRESS_STATES,
          status === "interrupted"
            ? { status, statusMessage: "pod gone before reconcile" }
            : { status, statusMessage: "pod gone before reconcile", completedAt: new Date() },
        );
        if (updated) {
          this.log.log(`reconcile: marked ${b.id} ${status} (orphan)`);
        }
      } catch (e) {
        // One benchmark's update failing must not skip every later benchmark.
        this.log.warn(`reconcile: updateGuarded(${b.id}) threw: ${(e as Error).message}`);
      }
    }
  }
}
