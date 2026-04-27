import type { BenchmarkApiType, BenchmarkDataset, BenchmarkProfile } from "@modeldoctor/contracts";

/**
 * Per-run input passed to a driver. Sensitive values (decrypted apiKey,
 * HMAC callback token) are passed by value; the driver is responsible for
 * propagating them safely to the runner without leaking to logs or process
 * listings.
 *
 * Implementer guidance:
 * - K8sJobDriver: sensitive values MUST be passed via
 *   `env.valueFrom.secretKeyRef`. Create a per-run Secret (with
 *   `ownerReferences` to the Job so it gets garbage-collected on Job
 *   deletion) and reference it from the container's `env`. Plain
 *   `env.value` strings leak via `kubectl describe`, `kubectl get -o yaml`,
 *   the K8s API audit log, and any operator with `get jobs` RBAC.
 * - SubprocessDriver: pass via the spawned process's `env`, never as argv
 *   (argv shows up in `ps`).
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

  // When false, the runner skips guidellm's GET /v1/models probe before
  // benchmarking — required for OpenAI-compatible gateways that only expose
  // /v1/chat/completions (e.g. some 4pd gen-studio routes). Default true
  // matches vanilla guidellm behavior.
  validateBackend: boolean;

  // Optional HuggingFace tokenizer id (e.g. "Qwen/Qwen2.5-0.5B-Instruct")
  // forwarded to guidellm via --processor for synthetic prompt token counts.
  // Required when `model` is a gateway-local name not on HF; if the gateway
  // model name itself resolves on HF, leave undefined.
  processor?: string;

  // Max in-flight concurrent requests when requestRate == 0 (throughput mode).
  // guidellm 0.5.x requires a rate parameter for ThroughputProfile — this is
  // the concurrency cap, not requests-per-second. Ignored for constant /
  // poisson rate modes.
  maxConcurrency: number;
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
