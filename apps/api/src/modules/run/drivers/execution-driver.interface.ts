import type { BuildCommandResult, ToolName } from "@modeldoctor/tool-adapters";

/**
 * Per-run input passed to a driver. Sensitive values flow via
 * `buildResult.secretEnv` and `buildResult.inputFiles` and MUST NOT
 * appear in argv. K8s drivers must materialize secrets via per-run
 * Secret + envFrom / volumeMount; subprocess driver merges secretEnv
 * into the spawn env.
 *
 * `image` is selected by the driver factory (`imageForTool`) and is
 * NOT part of the adapter's responsibility — adapters are deployment-
 * mode-agnostic.
 */
export interface RunExecutionContext {
  runId: string;
  tool: ToolName;
  buildResult: BuildCommandResult;
  callback: { url: string; token: string };
  image: string;
}

/** Opaque handle to an in-flight execution. */
export type RunExecutionHandle = string;

export interface RunExecutionDriver {
  /**
   * Start the runner. Resolves once the runner is launched (subprocess
   * spawned or Job created), NOT when the inner tool finishes.
   * Lifecycle progression after start() flows through HTTP callbacks.
   */
  start(ctx: RunExecutionContext): Promise<{ handle: RunExecutionHandle }>;

  /** Stop an in-flight execution. Idempotent. */
  cancel(handle: RunExecutionHandle): Promise<void>;

  /**
   * Release driver-side resources (subprocess wait, K8s Job delete) after
   * a run reaches a terminal state. Idempotent.
   */
  cleanup(handle: RunExecutionHandle): Promise<void>;
}
