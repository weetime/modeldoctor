import type { BatchV1Api, CoreV1Api } from "@kubernetes/client-node";
import { type BuildCommandResult, byTool, type ToolName } from "@modeldoctor/tool-adapters";
import { Injectable, Logger } from "@nestjs/common";
import { buildJobManifest, buildSecretManifest, jobName, secretName } from "./k8s-job-manifest.js";

/**
 * Per-run input the runner expects. Sensitive values flow via
 * `buildResult.secretEnv` and `buildResult.inputFiles` and MUST NOT
 * appear in argv. The runner materializes them as a per-run K8s Secret
 * and mounts them into the Job pod.
 *
 * `image` is resolved per-tool via `imageForTool()` (see
 * `runner-images.ts`) and is NOT part of the adapter's responsibility —
 * adapters are deployment-mode-agnostic.
 */
export interface BenchmarkRunInput {
  runId: string;
  tool: ToolName;
  buildResult: BuildCommandResult;
  image: string;
  /** Resume a previously-checkpointed run (tau3). Forwarded to the Job as
   *  MD_RESUME=1 alongside MD_CHECKPOINT_DIR so the runner loads existing
   *  progress instead of starting fresh. */
  resume?: boolean;
}

/** Opaque handle to an in-flight Job. Format: `<namespace>/<jobName>`. */
export type BenchmarkRunHandle = string;

/**
 * Launches benchmark Jobs in K8s. The single execution backend for
 * ModelDoctor (subprocess + driver-factory abstraction were removed in
 * #101). Lifecycle progression after `start()` flows through the K8s
 * watcher + pod log stream (Phase 1–3); this class only handles
 * spawn + cancel + cleanup.
 *
 * Wired via `useFactory` in `BenchmarkModule` so the kube client is
 * loaded lazily (skipping the import in test mode where we never run
 * a real K8s call). Tests instantiate this class directly with mocked
 * `BatchV1Api` / `CoreV1Api`.
 */
@Injectable()
export class K8sBenchmarkRunner {
  private readonly log = new Logger(K8sBenchmarkRunner.name);

  constructor(
    private readonly namespace: string,
    private readonly batch: BatchV1Api,
    private readonly core: CoreV1Api,
    /** Global HF tokenizer-source settings injected into every runner Job (#339). */
    private readonly hf?: { endpoint?: string; token?: string; offline?: boolean },
    /** Checkpoint-write interval (seconds) for resumable tools (tau3).
     *  Forwarded as MD_CHECKPOINT_INTERVAL_SEC when the tool's adapter
     *  reports a `checkpointDir`. */
    private readonly checkpointIntervalSec: number = 60,
  ) {}

  /**
   * Retry a control-plane call over a flaky apiserver link. The Mac↔ascend
   * path drops a sizeable fraction of requests (TLS ECONNRESET); a single
   * attempt routinely fails. Retries on network errors / 5xx / 429 (transient);
   * 4xx are deterministic and rethrow immediately. With `idempotent`, a 409
   * AlreadyExists (a lost-ack retry that re-created the resource) is treated as
   * success and resolves to null.
   */
  private async withRetry<T>(
    label: string,
    fn: () => Promise<T>,
    opts: { attempts?: number; idempotent?: boolean } = {},
  ): Promise<T | null> {
    const attempts = opts.attempts ?? 5;
    let lastErr: unknown;
    for (let i = 1; i <= attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        const status =
          (e as { statusCode?: number; response?: { statusCode?: number } }).response?.statusCode ??
          (e as { statusCode?: number }).statusCode;
        if (opts.idempotent && status === 409) {
          this.log.log(`${label}: already exists (409) — treating as success`);
          return null;
        }
        const transient = status === undefined || status >= 500 || status === 429;
        if (!transient) throw e;
        lastErr = e;
        if (i === attempts) break;
        const delay = Math.min(8000, 300 * 2 ** (i - 1));
        this.log.warn(
          `${label}: attempt ${i}/${attempts} failed (${(e as Error).message}); retry in ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr;
  }

  async start(ctx: BenchmarkRunInput): Promise<{ handle: BenchmarkRunHandle }> {
    const ns = this.namespace;
    const secret = buildSecretManifest(ctx, ns);
    await this.withRetry(
      "createNamespacedSecret",
      () => this.core.createNamespacedSecret(ns, secret),
      { idempotent: true },
    );

    let jobUid: string | undefined;
    try {
      const checkpointDir = byTool(ctx.tool).checkpointDir;
      const job = buildJobManifest(ctx, {
        namespace: ns,
        hf: this.hf,
        checkpointDir,
        checkpointIntervalSec: this.checkpointIntervalSec,
      });
      const created = await this.withRetry(
        "createNamespacedJob",
        () => this.batch.createNamespacedJob(ns, job),
        { idempotent: true },
      );
      jobUid = (created as { body?: { metadata?: { uid?: string } } } | null)?.body?.metadata?.uid;
    } catch (e) {
      try {
        await this.withRetry("rollback deleteNamespacedSecret", () =>
          this.core.deleteNamespacedSecret(secretName(ctx.runId), ns),
        );
      } catch (rbErr) {
        this.log.warn(
          `Failed to roll back Secret after Job-create failure: ${(rbErr as Error).message}`,
        );
      }
      throw e;
    }

    if (jobUid) {
      try {
        await this.withRetry("patchNamespacedSecret ownerRefs", () =>
          this.core.patchNamespacedSecret(
            secretName(ctx.runId),
            ns,
            {
              metadata: {
                ownerReferences: [
                  {
                    apiVersion: "batch/v1",
                    kind: "Job",
                    name: jobName(ctx.runId),
                    uid: jobUid,
                    controller: true,
                    blockOwnerDeletion: true,
                  },
                ],
              },
            },
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            { headers: { "Content-Type": "application/strategic-merge-patch+json" } },
          ),
        );
      } catch (e) {
        this.log.warn(`Failed to patch Secret ownerReferences: ${(e as Error).message}`);
      }
    }

    return { handle: `${ns}/${jobName(ctx.runId)}` };
  }

  async cancel(handle: BenchmarkRunHandle): Promise<void> {
    const [ns, name] = handle.split("/");
    if (!ns || !name) return;
    try {
      await this.batch.deleteNamespacedJob(
        name,
        ns,
        undefined,
        undefined,
        undefined,
        undefined,
        // propagationPolicy: 'Background' triggers Job → Secret cascade
        // via ownerReferences set in start().
        "Background",
      );
    } catch (e) {
      // K8sError shape: status code lives on .statusCode (and sometimes
      // .response?.statusCode); 404 means the Job is already gone, which
      // is an idempotent cancel — return silently. Anything else is a
      // real failure (e.g. apiserver flake, RBAC) and must propagate so
      // BenchmarkService doesn't mark the cancel as succeeded.
      const status =
        (e as { statusCode?: number; response?: { statusCode?: number } }).response?.statusCode ??
        (e as { statusCode?: number }).statusCode;
      if (status === 404) return;
      this.log.warn(`cancel: deleteNamespacedJob failed: ${(e as Error).message}`);
      throw e;
    }
  }

  /**
   * Foreground-delete the Job for a run so a resume-submit can recreate it
   * under the same name without an AlreadyExists collision. "Foreground"
   * propagation (vs. cancel()'s "Background") makes the delete call not
   * resolve until the Job + its cascaded pods are actually gone — resume
   * needs that ordering guarantee before it re-creates the Job. Cascades
   * to the per-run Secret too, via the ownerReference set in start().
   * 404 means the Job is already gone — idempotent no-op, same as cancel().
   */
  async deleteRun(runId: string): Promise<void> {
    const ns = this.namespace;
    try {
      await this.batch.deleteNamespacedJob(
        jobName(runId),
        ns,
        undefined,
        undefined,
        undefined,
        undefined,
        "Foreground",
      );
    } catch (e) {
      const status =
        (e as { statusCode?: number; response?: { statusCode?: number } }).response?.statusCode ??
        (e as { statusCode?: number }).statusCode;
      if (status === 404) return;
      this.log.warn(`deleteRun: deleteNamespacedJob failed: ${(e as Error).message}`);
      throw e;
    }
  }

  async cleanup(handle: BenchmarkRunHandle): Promise<void> {
    // K8s Job has TTL via spec.ttlSecondsAfterFinished; no explicit
    // cleanup needed. Method exists for service-side symmetry — the
    // service calls cleanup() unconditionally on terminal state.
    void handle;
  }
}
