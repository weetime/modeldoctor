import type { ListBenchmarksQuery } from "@modeldoctor/contracts";

export const benchmarkKeys = {
  all: ["benchmarks"] as const,
  lists: () => [...benchmarkKeys.all, "list"] as const,
  list: (q: Partial<ListBenchmarksQuery>) =>
    [...benchmarkKeys.lists(), q] as const,
  details: () => [...benchmarkKeys.all, "detail"] as const,
  detail: (id: string) => [...benchmarkKeys.details(), id] as const,
};

export const TERMINAL_STATES = ["completed", "failed", "canceled"] as const;
export type TerminalState = (typeof TERMINAL_STATES)[number];

// Hooks added in Task 2 (list) and Task 5 (detail).
