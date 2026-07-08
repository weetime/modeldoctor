/** Benchmark lifecycle states where the runner has not yet reached a terminal verdict. */
export const IN_PROGRESS_STATES = ["pending", "submitted", "running"] as const;
export type InProgressStatus = (typeof IN_PROGRESS_STATES)[number];

export function isInProgressStatus(status: string): boolean {
  return (IN_PROGRESS_STATES as readonly string[]).includes(status);
}

/**
 * Terminal states. Once a benchmark reaches one, no further status writes are
 * allowed via updateGuarded. "interrupted" is included here (not truly final —
 * a resumable run can be resumed later) purely so the reconciler/watcher stop
 * polling it like an IN_PROGRESS run; resuming goes through a dedicated path
 * that re-opens the row, not through this guard.
 */
export const TERMINAL_STATES = ["completed", "failed", "canceled", "interrupted"] as const;
export type TerminalStatus = (typeof TERMINAL_STATES)[number];
