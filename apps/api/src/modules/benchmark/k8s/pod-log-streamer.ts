import type * as k8s from "@kubernetes/client-node";
import type { Logger } from "@nestjs/common";
import * as readline from "node:readline";
import { PassThrough } from "node:stream";

type StreamerState = "IDLE" | "STREAMING" | "RECONNECTING" | "STOPPED";

const RECONNECT_BACKOFF_MS = [1000, 2000, 4000];
const MAX_CONSECUTIVE_FAILURES = 3;

function createDeferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Per-runId K8s pod log streamer. State machine:
 *    IDLE → STREAMING → (EOF) STOPPED
 *                    → (error) RECONNECTING → STREAMING (up to 3 attempts)
 *                                          → (give up) STOPPED
 *    abort() at any time → STOPPED (no further reconnects).
 *  The streamer does not know about tools, SSE, DB — handleLine is injected.
 *  All errors are swallowed (logged); upstream pool / watcher are not exposed
 *  to streamer faults. */
export class PodLogStreamer {
  private state: StreamerState = "IDLE";
  private currentReq: { abort(): void } | null = null;
  private currentSink: PassThrough | null = null;
  private consecutiveFailures = 0;
  private readonly eof = createDeferred<void>();

  constructor(
    private readonly runId: string,
    private readonly podName: string,
    private readonly container: string,
    private readonly namespace: string,
    private readonly k8sLog: Pick<k8s.Log, "log">,
    private readonly handleLine: (line: string) => void,
    private readonly log: Logger,
  ) {}

  async run(): Promise<void> {
    while (this.state !== "STOPPED" && this.consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
      this.state = "STREAMING";
      const passthrough = new PassThrough();
      this.currentSink = passthrough;

      // Set up the stream-done promise BEFORE calling k8sLog.log() so that
      // errors emitted synchronously (during the log() call or on the next tick
      // after it returns) are captured before run() resumes from the await.
      let streamResolve!: () => void;
      let streamReject!: (e: Error) => void;
      const streamDone = new Promise<void>((res, rej) => {
        streamResolve = res;
        streamReject = rej;
      });

      // clean end
      passthrough.on("end", () => streamResolve());
      // destroy without error (abort())
      passthrough.on("close", () => streamResolve());
      // destroy with error (stream failure)
      passthrough.on("error", (e) => streamReject(e));

      // Suppress readline errors — the passthrough error/close events drive the
      // reconnect loop; readline is just a line-splitting utility here.
      const rl = readline.createInterface({ input: passthrough, crlfDelay: Infinity });
      rl.on("line", (line) => {
        try {
          this.handleLine(line);
        } catch (e) {
          this.log.warn(`handleLine threw for ${this.runId}: ${(e as Error).message}`);
        }
      });
      rl.on("error", () => { /* handled via passthrough events */ });

      // Forward errors from any piped source to the sink.
      // In tests, k8sLog.log() pipes a PassThrough into our sink. Node.js
      // pipe does not propagate source errors to the destination, so we
      // intercept the 'pipe' event to wire up error forwarding manually.
      // If the source was already destroyed before piping (e.g. in the 3-fail
      // give-up test, all streams are pre-destroyed), we detect it via
      // src.destroyed and immediately destroy the sink.
      // In production the K8s client writes and calls sink.destroy(err)
      // directly, so the 'pipe' listener is an inert no-op.
      passthrough.on("pipe", (src: PassThrough) => {
        if (src.destroyed) {
          // Source already dead; propagate its error (or a generic one) now.
          if (!passthrough.destroyed) {
            passthrough.destroy(
              (src as unknown as { errored?: Error }).errored ?? new Error("piped from destroyed stream"),
            );
          }
        } else {
          src.on("error", (e: Error) => {
            if (!passthrough.destroyed) passthrough.destroy(e);
          });
        }
      });

      const opts: k8s.LogOptions = { follow: true };
      if (this.consecutiveFailures > 0) opts.sinceSeconds = 10;

      try {
        this.currentReq = await this.k8sLog.log(
          this.namespace, this.podName, this.container, passthrough, opts,
        );
        await streamDone;
        this.consecutiveFailures = 0;
        break;
      } catch (e) {
        this.consecutiveFailures += 1;
        if (this.state === "STOPPED") break;
        this.log.warn(
          `stream broke for ${this.runId} (attempt ${this.consecutiveFailures}): ${(e as Error).message}`,
        );
        this.state = "RECONNECTING";
        const idx = this.consecutiveFailures - 1;
        const backoff = RECONNECT_BACKOFF_MS[idx] ?? RECONNECT_BACKOFF_MS.at(-1)!;
        await sleep(backoff);
      } finally {
        rl.close();
        this.currentSink = null;
      }
    }
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.log.warn(`giving up on log stream for ${this.runId} after ${MAX_CONSECUTIVE_FAILURES} failures`);
    }
    this.state = "STOPPED";
    this.eof.resolve();
  }

  abort(): void {
    if (this.state === "STOPPED") return;
    this.state = "STOPPED";
    try {
      this.currentReq?.abort();
    } catch {
      // request may already be closed
    }
    // Destroy the sink so the in-flight streamDone await resolves via 'close'.
    if (this.currentSink && !this.currentSink.destroyed) {
      this.currentSink.destroy();
    }
    this.eof.resolve();
  }

  async drainOrTimeout(timeoutMs: number): Promise<void> {
    if (timeoutMs <= 0) {
      this.abort();
      return;
    }
    const drained = this.eof.promise.then(() => "drained" as const);
    const timeout = sleep(timeoutMs).then(() => "timeout" as const);
    const r = await Promise.race([drained, timeout]);
    if (r === "timeout") this.abort();
  }
}
