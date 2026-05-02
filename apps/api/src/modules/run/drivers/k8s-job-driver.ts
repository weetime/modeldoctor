import type { BatchV1Api, CoreV1Api } from "@kubernetes/client-node";
import { Logger } from "@nestjs/common";
import type {
  RunExecutionContext,
  RunExecutionDriver,
  RunExecutionHandle,
} from "./execution-driver.interface.js";
import { buildJobManifest, buildSecretManifest, jobName, secretName } from "./k8s-job-manifest.js";

export interface K8sJobDriverOpts {
  namespace: string;
  apis: { batch: BatchV1Api; core: CoreV1Api };
}

export class K8sJobDriver implements RunExecutionDriver {
  private readonly log = new Logger(K8sJobDriver.name);
  private readonly namespace: string;
  private readonly batch: BatchV1Api;
  private readonly core: CoreV1Api;

  constructor(opts: K8sJobDriverOpts) {
    this.namespace = opts.namespace;
    this.batch = opts.apis.batch;
    this.core = opts.apis.core;
  }

  async start(ctx: RunExecutionContext): Promise<{ handle: RunExecutionHandle }> {
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

  async cancel(handle: RunExecutionHandle): Promise<void> {
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
        // via ownerReferences set in start()
        "Background",
      );
    } catch (e) {
      this.log.warn(`cancel: deleteNamespacedJob failed: ${(e as Error).message}`);
    }
  }

  async cleanup(handle: RunExecutionHandle): Promise<void> {
    // K8s Job has TTL via spec.ttlSecondsAfterFinished; no explicit cleanup needed.
    // Method exists for interface symmetry.
    void handle;
  }
}
