import type { V1Pod } from "@kubernetes/client-node";
import { isInProgressStatus } from "../constants.js";
import { getRunnerStatus } from "./runner-container.js";

/**
 * Pod waiting reasons we treat as "won't self-recover" — once the grace
 * period elapses, the watcher marks the benchmark failed.
 *
 * Source: K8s kubelet container statuses + image-puller error codes.
 * Update if K8s introduces new fatal reasons or if ops needs to recategorize.
 */
export const DEFAULT_FATAL_WAITING_REASONS = [
  "ImagePullBackOff",
  "CrashLoopBackOff",
  "ErrImagePull",
  "CreateContainerConfigError",
  "CreateContainerError",
  "InvalidImageName",
] as const;

export interface ReducerConfig {
  fatalWaitingReasons: readonly string[];
  waitingFatalGraceSec: number;
  terminalReconcileGraceSec: number;
}

export type DesiredTransition =
  | { kind: "running"; startedAt: Date }
  | { kind: "load-report" }
  | { kind: "failed-pre-start"; reason: string; message: string }
  | { kind: "failed-terminal"; exitCode: number; reason: string; message: string }
  | { kind: "noop" };

export interface ReducerInput {
  pod: V1Pod;
  currentStatus: string;
  /** Earliest time the watcher service observed this pod in a FATAL waiting state.
   *  null if not currently in FATAL waiting OR this is the first observation. */
  firstFatalWaitingAt: Date | null;
  /** Earliest time the watcher service observed this pod in a terminal phase.
   *  null if not in terminal phase. */
  firstTerminalAt: Date | null;
  now: Date;
  config: ReducerConfig;
  mode: "backstop" | "primary";
}

/** 2 KiB cap: statusMessage is TEXT in Postgres but watcher-sourced messages
 *  are diagnostic, not data — truncate to keep DB rows compact and UI usable. */
const MAX_MSG_LEN = 2048;

function truncate(s: string): string {
  return s.length > MAX_MSG_LEN ? s.slice(0, MAX_MSG_LEN) : s;
}

function getWaitingReason(pod: V1Pod): { reason: string; message: string } | null {
  const cs = getRunnerStatus(pod);
  const w = cs?.state?.waiting;
  if (!w?.reason) return null;
  return { reason: w.reason, message: w.message ?? "" };
}

function getTerminated(pod: V1Pod): { exitCode: number; reason: string; message: string } | null {
  const cs = getRunnerStatus(pod);
  const t = cs?.state?.terminated;
  if (!t) return null;
  return {
    exitCode: t.exitCode ?? -1,
    reason: t.reason ?? "Unknown",
    message: t.message ?? "",
  };
}

export function reduce(input: ReducerInput): DesiredTransition {
  const { pod, currentStatus, firstFatalWaitingAt, firstTerminalAt, now, config } = input;

  // Hard guard: never touch benchmarks that are already in a terminal state.
  if (!isInProgressStatus(currentStatus)) return { kind: "noop" };

  if (input.mode === "primary") {
    return reducePrimary(input);
  }
  // fall through to existing backstop body

  const phase = pod.status?.phase;

  // 1. FATAL waiting (pre-start failure)
  const waiting = getWaitingReason(pod);
  if (waiting && config.fatalWaitingReasons.includes(waiting.reason)) {
    if (firstFatalWaitingAt) {
      const elapsedSec = (now.getTime() - firstFatalWaitingAt.getTime()) / 1000;
      if (elapsedSec >= config.waitingFatalGraceSec) {
        return {
          kind: "failed-pre-start",
          reason: waiting.reason,
          message: truncate(`${waiting.reason}: ${waiting.message}`),
        };
      }
    }
    return { kind: "noop" };
  }

  // 2. Terminal phase (Succeeded or Failed) + benchmark still IN_PROGRESS + grace elapsed
  if (phase === "Failed" || phase === "Succeeded") {
    if (firstTerminalAt) {
      const elapsedSec = (now.getTime() - firstTerminalAt.getTime()) / 1000;
      if (elapsedSec >= config.terminalReconcileGraceSec) {
        const term = getTerminated(pod);
        if (phase === "Failed") {
          return {
            kind: "failed-terminal",
            exitCode: term?.exitCode ?? -1,
            reason: term?.reason ?? "PodFailed",
            message: truncate(term ? `${term.reason}: ${term.message}` : "pod in Failed phase"),
          };
        }
        // Phase Succeeded implies all containers exited 0 by K8s contract — no need to
        // inspect getTerminated(). Failure here means "runner finished but never called back".
        return {
          kind: "failed-terminal",
          exitCode: 0,
          reason: "NoCallback",
          message: "runner pod succeeded but callback never arrived",
        };
      }
    }
    return { kind: "noop" };
  }

  // 3. Running / Pending / Unknown — backstop does nothing.
  return { kind: "noop" };
}

function reducePrimary(input: ReducerInput): DesiredTransition {
  const { pod, currentStatus, firstFatalWaitingAt, now, config } = input;
  const phase = pod.status?.phase;

  // 1. Succeeded → trigger ReportLoader
  if (phase === "Succeeded") return { kind: "load-report" };

  // 2. Failed → write failed directly (no grace)
  if (phase === "Failed") {
    const term = getTerminated(pod);
    return {
      kind: "failed-terminal",
      exitCode: term?.exitCode ?? -1,
      reason: term?.reason ?? "PodFailed",
      message: truncate(term ? `${term.reason}: ${term.message}` : "pod in Failed phase"),
    };
  }

  // 3. FATAL waiting + grace elapsed
  const waiting = getWaitingReason(pod);
  if (waiting && config.fatalWaitingReasons.includes(waiting.reason)) {
    if (firstFatalWaitingAt) {
      const elapsedSec = (now.getTime() - firstFatalWaitingAt.getTime()) / 1000;
      if (elapsedSec >= config.waitingFatalGraceSec) {
        return {
          kind: "failed-pre-start",
          reason: waiting.reason,
          message: truncate(`${waiting.reason}: ${waiting.message}`),
        };
      }
    }
    return { kind: "noop" };
  }

  // 4. Running + container ready + currentStatus=submitted → mark running
  if (phase === "Running" && currentStatus === "submitted") {
    const runner = getRunnerStatus(pod);
    if (runner?.ready) {
      const startedAt = runner.state?.running?.startedAt ?? now;
      return { kind: "running", startedAt: new Date(startedAt) };
    }
  }

  return { kind: "noop" };
}
