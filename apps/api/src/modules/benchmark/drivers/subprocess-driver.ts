import { type ChildProcess, spawn } from "node:child_process";
import { Injectable, Logger } from "@nestjs/common";
import type {
  BenchmarkExecutionContext,
  BenchmarkExecutionDriver,
  BenchmarkExecutionHandle,
} from "./execution-driver.interface.js";

interface Entry {
  child: ChildProcess;
  killTimer?: NodeJS.Timeout;
}

const SIGKILL_DELAY_MS = 10_000;

@Injectable()
export class SubprocessDriver implements BenchmarkExecutionDriver {
  private readonly log = new Logger(SubprocessDriver.name);
  private readonly handles = new Map<BenchmarkExecutionHandle, Entry>();

  async start(ctx: BenchmarkExecutionContext): Promise<{ handle: BenchmarkExecutionHandle }> {
    const args = ["benchmark", "run"];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      BENCHMARK_ID: ctx.benchmarkId,
      CALLBACK_URL: ctx.callbackUrl,
      CALLBACK_TOKEN: ctx.callbackToken,
      TARGET_URL: ctx.apiBaseUrl,
      API_KEY: ctx.apiKey,
      MODEL: ctx.model,
      API_TYPE: ctx.apiType,
      DATASET_NAME: ctx.datasetName,
      PROMPT_TOKENS: String(ctx.datasetInputTokens ?? ""),
      OUTPUT_TOKENS: String(ctx.datasetOutputTokens ?? ""),
      REQUEST_RATE: String(ctx.requestRate),
      TOTAL_REQUESTS: String(ctx.totalRequests),
      MAX_DURATION_SECONDS: String(ctx.maxDurationSeconds),
      VALIDATE_BACKEND: ctx.validateBackend ? "true" : "false",
    };
    if (ctx.datasetSeed !== undefined) {
      env.DATASET_SEED = String(ctx.datasetSeed);
    }
    if (ctx.processor) {
      env.PROCESSOR = ctx.processor;
    }
    env.MAX_CONCURRENCY = String(ctx.maxConcurrency);

    const child = spawn("benchmark-runner", args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    if (!child.pid) {
      throw new Error("SubprocessDriver: failed to spawn benchmark-runner (no pid)");
    }
    const handle: BenchmarkExecutionHandle = `subprocess:${child.pid}`;
    this.handles.set(handle, { child });

    child.on("exit", (code, signal) => {
      this.log.log(`subprocess ${handle} exited code=${code ?? "null"} signal=${signal ?? "null"}`);
      const entry = this.handles.get(handle);
      if (entry?.killTimer) clearTimeout(entry.killTimer);
      this.handles.delete(handle);
    });

    return { handle };
  }

  async cancel(handle: BenchmarkExecutionHandle): Promise<void> {
    const entry = this.handles.get(handle);
    if (!entry) return; // unknown handle (post-restart) → silent ok
    entry.child.kill("SIGTERM");
    entry.killTimer = setTimeout(() => {
      if (!entry.child.killed) entry.child.kill("SIGKILL");
    }, SIGKILL_DELAY_MS);
    // Don't unref — let the timer keep us alive until the kill resolves.
  }

  async cleanup(handle: BenchmarkExecutionHandle): Promise<void> {
    const entry = this.handles.get(handle);
    if (!entry) return;
    if (entry.killTimer) clearTimeout(entry.killTimer);
    this.handles.delete(handle);
  }
}
