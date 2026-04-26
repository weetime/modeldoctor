import type { BatchV1Api, CoreV1Api } from "@kubernetes/client-node";
import { Logger } from "@nestjs/common";
import type {
  BenchmarkExecutionContext,
  BenchmarkExecutionDriver,
  BenchmarkExecutionHandle,
} from "./execution-driver.interface.js";
import { buildJobManifest, buildSecretManifest, jobName, secretName } from "./k8s-job-manifest.js";

export interface K8sJobDriverOpts {
  namespace: string;
  image: string;
  apis: { batch: BatchV1Api; core: CoreV1Api };
}

export class K8sJobDriver implements BenchmarkExecutionDriver {
  private readonly log = new Logger(K8sJobDriver.name);
  private readonly namespace: string;
  private readonly image: string;
  private readonly batch: BatchV1Api;
  private readonly core: CoreV1Api;

  constructor(opts: K8sJobDriverOpts) {
    this.namespace = opts.namespace;
    this.image = opts.image;
    this.batch = opts.apis.batch;
    this.core = opts.apis.core;
  }

  async start(ctx: BenchmarkExecutionContext): Promise<{ handle: BenchmarkExecutionHandle }> {
    const ns = this.namespace;
    const secret = buildSecretManifest(ctx, ns);
    await this.core.createNamespacedSecret(ns, secret);

    let jobUid: string | undefined;
    try {
      const job = buildJobManifest(ctx, { namespace: ns, image: this.image });
      const created = await this.batch.createNamespacedJob(ns, job);
      jobUid = (created as { body?: { metadata?: { uid?: string } } }).body?.metadata?.uid;
    } catch (e) {
      // Roll back the orphan Secret; rethrow.
      try {
        await this.core.deleteNamespacedSecret(secretName(ctx.benchmarkId), ns);
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
          secretName(ctx.benchmarkId),
          ns,
          {
            metadata: {
              ownerReferences: [
                {
                  apiVersion: "batch/v1",
                  kind: "Job",
                  name: jobName(ctx.benchmarkId),
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
        // Worst case: Secret outlives Job (manual cleanup). Don't fail the run.
        this.log.warn(`Failed to patch Secret ownerReferences: ${(e as Error).message}`);
      }
    }

    return { handle: `${ns}/${jobName(ctx.benchmarkId)}` };
  }

  async cancel(handle: BenchmarkExecutionHandle): Promise<void> {
    const [ns, name] = parseHandle(handle);
    try {
      await this.batch.deleteNamespacedJob(
        name,
        ns,
        undefined,
        undefined,
        undefined,
        undefined,
        "Foreground",
      );
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404) return; // already gone — silent ok
      throw e;
    }
  }

  async cleanup(_handle: BenchmarkExecutionHandle): Promise<void> {
    // No-op: ttlSecondsAfterFinished GCs the Job (and the owner-referenced Secret).
  }
}

function parseHandle(handle: BenchmarkExecutionHandle): [string, string] {
  const idx = handle.indexOf("/");
  if (idx <= 0 || idx === handle.length - 1) {
    throw new Error(`K8sJobDriver: malformed handle ${handle}`);
  }
  return [handle.slice(0, idx), handle.slice(idx + 1)];
}
