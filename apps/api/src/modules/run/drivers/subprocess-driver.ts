import { type ChildProcess, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import type {
  RunExecutionContext,
  RunExecutionDriver,
  RunExecutionHandle,
} from "./execution-driver.interface.js";

interface Entry {
  child: ChildProcess;
  killTimer?: NodeJS.Timeout;
  cwd: string;
}

const SIGKILL_DELAY_MS = 10_000;

export interface SubprocessDriverOpts {
  cwdRoot?: string;
}

@Injectable()
export class SubprocessDriver implements RunExecutionDriver {
  private readonly log = new Logger(SubprocessDriver.name);
  private readonly handles = new Map<RunExecutionHandle, Entry>();
  private readonly cwdRoot: string;

  constructor(opts: SubprocessDriverOpts = {}) {
    this.cwdRoot = opts.cwdRoot ?? path.join(os.tmpdir(), "modeldoctor-runs");
  }

  async start(ctx: RunExecutionContext): Promise<{ handle: RunExecutionHandle }> {
    const cwd = path.join(this.cwdRoot, `run-${ctx.runId}`);
    await fs.mkdir(cwd, { recursive: true });

    // Write inputFiles before spawn
    for (const [relPath, content] of Object.entries(ctx.buildResult.inputFiles ?? {})) {
      const full = path.join(cwd, relPath);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content);
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...ctx.buildResult.env,
      ...ctx.buildResult.secretEnv,
      MD_RUN_ID: ctx.runId,
      MD_CALLBACK_URL: ctx.callback.url,
      MD_CALLBACK_TOKEN: ctx.callback.token,
      MD_ARGV: JSON.stringify(ctx.buildResult.argv),
      MD_OUTPUT_FILES: JSON.stringify(ctx.buildResult.outputFiles),
    };

    const child = spawn("benchmark-runner-wrapper", [], {
      env,
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    if (!child.pid) {
      throw new Error("SubprocessDriver: failed to spawn wrapper (no pid)");
    }

    // Drain stdout/stderr so the child doesn't block on a full pipe
    // buffer (~16KB). Pipes are kept (Phase 3 wrapper will tail them
    // via HTTP /log); resume() just discards bytes until then.
    child.stdout?.resume();
    child.stderr?.resume();

    const handle: RunExecutionHandle = `subprocess:${child.pid}`;
    this.handles.set(handle, { child, cwd });

    child.on("exit", (code, signal) => {
      this.log.log(`subprocess ${handle} exited code=${code ?? "null"} signal=${signal ?? "null"}`);
      const entry = this.handles.get(handle);
      if (entry?.killTimer) clearTimeout(entry.killTimer);
      this.handles.delete(handle);
    });

    child.on("error", (err) => {
      this.log.error(`subprocess ${handle} error: ${err.message}`);
      const entry = this.handles.get(handle);
      if (entry?.killTimer) clearTimeout(entry.killTimer);
      this.handles.delete(handle);
    });

    return { handle };
  }

  async cancel(handle: RunExecutionHandle): Promise<void> {
    const entry = this.handles.get(handle);
    if (!entry) return;
    entry.child.kill("SIGTERM");
    entry.killTimer = setTimeout(() => {
      if (!entry.child.killed) entry.child.kill("SIGKILL");
    }, SIGKILL_DELAY_MS);
  }

  async cleanup(handle: RunExecutionHandle): Promise<void> {
    const entry = this.handles.get(handle);
    if (!entry) return;
    if (entry.killTimer) clearTimeout(entry.killTimer);
    this.handles.delete(handle);
    // Note: cwd cleanup is intentionally NOT done here — the runner
    // wrapper has already shipped outputFiles via /finish; cwd just
    // contains scratch space we leave for post-mortem inspection. A
    // separate cron sweep can prune /tmp/modeldoctor-runs/ if needed.
  }
}
