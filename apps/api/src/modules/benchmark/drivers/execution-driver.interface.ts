import type { BenchmarkApiType, BenchmarkDataset, BenchmarkProfile } from "@modeldoctor/contracts";

/**
 * Per-run input passed to a driver. Sensitive values (decrypted apiKey,
 * HMAC callback token) are passed by value; the driver is responsible for
 * propagating them to the runner via env or k8s Secret without leaking to
 * logs or process listings.
 */
export interface BenchmarkExecutionContext {
  benchmarkId: string;
  profile: BenchmarkProfile;

  // Target endpoint
  apiType: BenchmarkApiType;
  apiUrl: string;
  apiKey: string;
  model: string;

  // Workload
  datasetName: BenchmarkDataset;
  datasetInputTokens?: number;
  datasetOutputTokens?: number;
  datasetSeed?: number;
  requestRate: number;
  totalRequests: number;
  maxDurationSeconds: number;

  // Callback
  callbackUrl: string;
  callbackToken: string;
}

/**
 * Opaque handle to an in-flight execution. SubprocessDriver uses
 * "subprocess:<pid>"; K8sJobDriver uses "<namespace>/<jobName>".
 * The service stores this on BenchmarkRun.jobName for cancel/cleanup.
 */
export type BenchmarkExecutionHandle = string;

export interface BenchmarkExecutionDriver {
  /**
   * Start an execution. Resolves once the runner is launched (process spawned
   * or Job created), NOT when the benchmark finishes. Lifecycle progression
   * after start() is reported by the runner via HTTP callbacks.
   */
  start(ctx: BenchmarkExecutionContext): Promise<{ handle: BenchmarkExecutionHandle }>;

  /** Stop an in-flight execution. Idempotent. */
  cancel(handle: BenchmarkExecutionHandle): Promise<void>;

  /**
   * Release driver-side resources (subprocess wait, K8s Job delete) after
   * a run reaches a terminal state. Idempotent — safe to call multiple
   * times or on a handle whose underlying execution is already gone.
   */
  cleanup(handle: BenchmarkExecutionHandle): Promise<void>;
}
