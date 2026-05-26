import type { ToolName } from "@modeldoctor/tool-adapters";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { PodLogStreamer } from "./pod-log-streamer.js";
import { PodLogStreamerFactory } from "./pod-log-streamer-factory.js";
import { ProgressThrottle } from "./progress-throttle.js";

const PROGRESS_THROTTLE_WINDOW_MS = 1000;

/** Singleton pool of per-runId PodLogStreamer instances. The watcher service
 *  calls start/stop/drainAndStop in response to pod lifecycle events.
 *  All operations are idempotent so the watcher can call them on every pod
 *  event without bookkeeping. */
@Injectable()
export class PodLogStreamerPool implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PodLogStreamerPool.name);
  private readonly streamers = new Map<string, PodLogStreamer>();
  private readonly throttles = new Map<string, ProgressThrottle>();

  constructor(private readonly factory: PodLogStreamerFactory) {}

  async onModuleInit(): Promise<void> {
    await this.factory.probeRbac();
  }

  /** Idempotent. If a streamer already exists for runId, no-op. */
  start(runId: string, podName: string, tool: ToolName): void {
    if (this.streamers.has(runId)) return;
    const throttle = new ProgressThrottle(runId, this.factory.repo, PROGRESS_THROTTLE_WINDOW_MS);
    this.throttles.set(runId, throttle);
    const streamer = this.factory.create(runId, podName, tool, throttle);
    this.streamers.set(runId, streamer);
    streamer.run().catch((e) => {
      this.log.warn(`streamer.run threw for ${runId}: ${(e as Error).message}`);
    });
  }

  /** Force-stop. No drain wait. For pod-delete / cancel paths. */
  stop(runId: string): void {
    const streamer = this.streamers.get(runId);
    if (!streamer) return;
    streamer.abort();
    this.streamers.delete(runId);
    const throttle = this.throttles.get(runId);
    if (throttle) {
      void throttle.flushNow();
      this.throttles.delete(runId);
    }
  }

  /** Wait for natural EOF up to timeoutMs, then force-stop.
   *  For terminal pod events (Succeeded → 5000ms; Failed → 0ms). */
  async drainAndStop(runId: string, timeoutMs: number): Promise<void> {
    const streamer = this.streamers.get(runId);
    if (!streamer) return;
    await streamer.drainOrTimeout(timeoutMs);
    this.streamers.delete(runId);
    const throttle = this.throttles.get(runId);
    if (throttle) {
      await throttle.flushNow();
      this.throttles.delete(runId);
    }
  }

  has(runId: string): boolean {
    return this.streamers.has(runId);
  }

  async onModuleDestroy(): Promise<void> {
    for (const [, s] of this.streamers) s.abort();
    this.streamers.clear();
    for (const [, t] of this.throttles) await t.flushNow();
    this.throttles.clear();
  }
}
