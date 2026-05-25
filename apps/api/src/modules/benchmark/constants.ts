/** Benchmark lifecycle states where the runner has not yet reached a terminal verdict. */
export const IN_PROGRESS_STATES = ["pending", "submitted", "running"] as const;
export type InProgressStatus = (typeof IN_PROGRESS_STATES)[number];

export function isInProgressStatus(status: string): boolean {
  return (IN_PROGRESS_STATES as readonly string[]).includes(status);
}

/** Terminal states. Once a benchmark reaches one, no further status writes are allowed. */
export const TERMINAL_STATES = ["completed", "failed", "canceled"] as const;
export type TerminalStatus = (typeof TERMINAL_STATES)[number];
