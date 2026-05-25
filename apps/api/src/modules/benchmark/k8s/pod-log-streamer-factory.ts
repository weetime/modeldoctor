import type * as k8s from "@kubernetes/client-node";
import { byTool, type ProgressEvent, type ToolName } from "@modeldoctor/tool-adapters";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Writable } from "node:stream";
import { BenchmarkRepository } from "../benchmark.repository.js";
import { SseHub } from "../sse/sse-hub.service.js";
import { PodLogStreamer } from "./pod-log-streamer.js";
import type { ProgressThrottle } from "./progress-throttle.js";
import { RUNNER_CONTAINER_NAME } from "./runner-container.js";

/** Nest DI tokens — see benchmark.module.ts for provider registration. */
export const K8S_LOG_CLIENT = Symbol("K8S_LOG_CLIENT");
export const K8S_NAMESPACE = Symbol("K8S_NAMESPACE");

/** Builds PodLogStreamer instances with a tool-aware handleLine closure.
 *  Separated from PodLogStreamerPool so the pool stays a thin lifecycle
 *  manager and the factory holds the SSE / adapter / DI wiring. */
@Injectable()
export class PodLogStreamerFactory {
  constructor(
    public readonly repo: BenchmarkRepository,  // public: ProgressThrottle ctor needs it
    private readonly sse: SseHub,
    @Inject(K8S_LOG_CLIENT) private readonly k8sLog: Pick<k8s.Log, "log">,
    @Inject(K8S_NAMESPACE) private readonly namespace: string,
  ) {}

  /** Synchronous — tool is passed in; no async bench lookup (watcher already
   *  has bench loaded when it calls pool.start). */
  create(runId: string, podName: string, tool: ToolName, throttle: ProgressThrottle): PodLogStreamer {
    return new PodLogStreamer(
      runId, podName, RUNNER_CONTAINER_NAME, this.namespace,
      this.k8sLog,
      this.buildHandleLine(runId, tool, throttle),
      new Logger(`PodLogStreamer:${runId}`),
    );
  }

  /** Exposed for unit tests. */
  buildHandleLine(runId: string, tool: ToolName, throttle: ProgressThrottle): (line: string) => void {
    const adapter = byTool(tool);
    return (line: string) => {
      let evt: ProgressEvent | null;
      try {
        evt = adapter.parseProgress(line);
      } catch {
        evt = { kind: "log", level: "warn", line };
      }
      if (!evt) return;
      this.sse.publish(runId, evt);
      if (evt.kind === "progress") throttle.tick(evt.pct);
    };
  }

  /** Boot-time RBAC self-check (spec D8). Probes pods/log:get against a
   *  guaranteed-nonexistent pod name; 404 means RBAC OK, 403 means
   *  missing pods/log permission → boot fail. Other errors are logged
   *  and swallowed (apiserver transient flake should not block boot). */
  async probeRbac(): Promise<void> {
    const sink = new Writable({ write(_c, _e, cb) { cb(); } });
    try {
      await this.k8sLog.log(this.namespace, "__rbac-probe__", RUNNER_CONTAINER_NAME, sink, {
        follow: false,
      });
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/403|forbidden/i.test(msg)) {
        throw new Error(
          `PodLogStreamerPool: RBAC missing pods/log:get in ns=${this.namespace}: ${msg}`,
        );
      }
      // 404 or transient — log only, do not fail boot
      new Logger(PodLogStreamerFactory.name).log(
        `RBAC probe non-fatal error (expected on 404): ${msg.slice(0, 200)}`,
      );
    }
  }
}
