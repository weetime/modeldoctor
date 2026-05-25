import type { V1Pod } from "@kubernetes/client-node";
import { isInProgressStatus } from "../constants.js";

export interface ReducerConfig {
  fatalWaitingReasons: readonly string[];
  waitingFatalGraceSec: number;
  terminalReconcileGraceSec: number;
}

export type DesiredTransition =
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
}

/** 2 KiB cap: statusMessage is TEXT in Postgres but watcher-sourced messages
 *  are diagnostic, not data — truncate to keep DB rows compact and UI usable. */
const MAX_MSG_LEN = 2048;

function truncate(s: string): string {
  return s.length > MAX_MSG_LEN ? s.slice(0, MAX_MSG_LEN) : s;
}

function getWaitingReason(pod: V1Pod): { reason: string; message: string } | null {
  const cs = pod.status?.containerStatuses?.[0];
  const w = cs?.state?.waiting;
  if (!w?.reason) return null;
  return { reason: w.reason, message: w.message ?? "" };
}

function getTerminated(pod: V1Pod): { exitCode: number; reason: string; message: string } | null {
  const cs = pod.status?.containerStatuses?.[0];
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
            message: truncate(
              term ? `${term.reason}: ${term.message}` : "pod in Failed phase",
            ),
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
