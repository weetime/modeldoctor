import type { BatchV1Api, CoreV1Api } from "@kubernetes/client-node";
import type { BuildCommandResult, ToolName } from "@modeldoctor/tool-adapters";
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
  callback: { url: string; token: string };
  image: string;
}

/** Opaque handle to an in-flight Job. Format: `<namespace>/<jobName>`. */
export type BenchmarkRunHandle = string;

/**
 * Launches benchmark Jobs in K8s. The single execution backend for
 * ModelDoctor (subprocess + driver-factory abstraction were removed in
 * #101). Lifecycle progression after `start()` flows through HTTP
 * callbacks; this class only handles spawn + cancel + cleanup.
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
  ) {}

  async start(ctx: BenchmarkRunInput): Promise<{ handle: BenchmarkRunHandle }> {
    const ns = this.namespace;
    const secret = buildSecretManifest(ctx, ns);
    await this.core.createNamespacedSecret(ns, secret);

    let jobUid: string | undefined;
    try {
      const job = buildJobManifest(ctx, { namespace: ns });
      const created = await this.batch.createNamespacedJob(ns, job);
      jobUid = (created as { body?: { metadata?: { uid?: string } } }).body?.metadata?.uid;
    } catch (e) {
      try {
        await this.core.deleteNamespacedSecret(secretName(ctx.runId), ns);
      } catch (rbErr) {
        this.log.warn(
          `Failed to roll back Secret after Job-create failure: ${(rbErr as Error).message}`,
        );
      }
      throw e;
    }

    if (jobUid) {
      try {
        await this.core.patchNamespacedSecret(
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

  async cleanup(handle: BenchmarkRunHandle): Promise<void> {
    // K8s Job has TTL via spec.ttlSecondsAfterFinished; no explicit
    // cleanup needed. Method exists for service-side symmetry — the
    // service calls cleanup() unconditionally on terminal state.
    void handle;
  }
}
