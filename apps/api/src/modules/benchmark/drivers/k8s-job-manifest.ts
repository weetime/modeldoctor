import type { V1Job, V1Secret } from "@kubernetes/client-node";
import type { BenchmarkExecutionContext } from "./execution-driver.interface.js";

export function jobName(benchmarkId: string): string {
  return `benchmark-${benchmarkId}`;
}

export function secretName(benchmarkId: string): string {
  return `benchmark-${benchmarkId}`;
}

const LABELS = {
  "app.kubernetes.io/name": "modeldoctor-benchmark-runner",
  "app.kubernetes.io/managed-by": "modeldoctor-api",
};

export function buildSecretManifest(ctx: BenchmarkExecutionContext, namespace: string): V1Secret {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: secretName(ctx.benchmarkId),
      namespace,
      labels: { ...LABELS, "modeldoctor.ai/benchmark-id": ctx.benchmarkId },
    },
    type: "Opaque",
    stringData: {
      API_KEY: ctx.apiKey,
      CALLBACK_TOKEN: ctx.callbackToken,
    },
  };
}

export interface JobManifestOptions {
  namespace: string;
  image: string;
}

export function buildJobManifest(ctx: BenchmarkExecutionContext, opts: JobManifestOptions): V1Job {
  const env: { name: string; value: string }[] = [
    { name: "BENCHMARK_ID", value: ctx.benchmarkId },
    { name: "CALLBACK_URL", value: ctx.callbackUrl },
    { name: "TARGET_URL", value: ctx.apiBaseUrl },
    { name: "MODEL", value: ctx.model },
    { name: "API_TYPE", value: ctx.apiType },
    { name: "DATASET_NAME", value: ctx.datasetName },
    { name: "PROMPT_TOKENS", value: String(ctx.datasetInputTokens ?? "") },
    { name: "OUTPUT_TOKENS", value: String(ctx.datasetOutputTokens ?? "") },
    { name: "REQUEST_RATE", value: String(ctx.requestRate) },
    { name: "TOTAL_REQUESTS", value: String(ctx.totalRequests) },
    { name: "MAX_DURATION_SECONDS", value: String(ctx.maxDurationSeconds) },
    { name: "VALIDATE_BACKEND", value: ctx.validateBackend ? "true" : "false" },
  ];
  if (ctx.datasetSeed !== undefined) {
    env.push({ name: "DATASET_SEED", value: String(ctx.datasetSeed) });
  }
  if (ctx.processor) {
    env.push({ name: "PROCESSOR", value: ctx.processor });
  }
  env.push({ name: "MAX_CONCURRENCY", value: String(ctx.maxConcurrency) });

  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: jobName(ctx.benchmarkId),
      namespace: opts.namespace,
      labels: { ...LABELS, "modeldoctor.ai/benchmark-id": ctx.benchmarkId },
    },
    spec: {
      backoffLimit: 0,
      ttlSecondsAfterFinished: 3600,
      template: {
        metadata: {
          labels: { ...LABELS, "modeldoctor.ai/benchmark-id": ctx.benchmarkId },
        },
        spec: {
          restartPolicy: "Never",
          containers: [
            {
              name: "runner",
              image: opts.image,
              imagePullPolicy: "IfNotPresent",
              env,
              envFrom: [{ secretRef: { name: secretName(ctx.benchmarkId) } }],
              resources: {
                requests: { cpu: "500m", memory: "512Mi" },
                limits: { cpu: "2", memory: "2Gi" },
              },
            },
          ],
        },
      },
    },
  };
}
