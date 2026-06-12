import type { BenchmarkStatus } from "@modeldoctor/contracts";
import { format } from "date-fns";

const TERMINAL_STATUSES = new Set<BenchmarkStatus>(["completed", "failed", "canceled"]);

/** Elapsed run time in ms, or null when it can't be known. Active runs
 *  (pending/submitted/running) fall back to a live now-startedAt delta;
 *  terminal runs missing completedAt (e.g. failed before the runner reported
 *  back) return null — a live delta there would grow forever. */
export function runDurationMs(
  startedAt: string | null,
  completedAt: string | null,
  status: BenchmarkStatus,
): number | null {
  if (!startedAt) return null;
  if (completedAt) return new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (TERMINAL_STATUSES.has(status)) return null;
  return Date.now() - new Date(startedAt).getTime();
}

/** GitHub-Actions-style compact duration: "29s", "4m 32s", "1h 3m 5s". */
export function fmtDurationMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** "06-12 10:21:05 → 10:25:37" (end repeats the date only across midnight);
 *  open-ended "06-12 10:21:05 →" while the run has no end yet. */
export function fmtTimeRange(startIso: string, endIso: string | null): string {
  const start = new Date(startIso);
  const startStr = format(start, "MM-dd HH:mm:ss");
  if (!endIso) return `${startStr} →`;
  const end = new Date(endIso);
  const sameDay = format(start, "yyyy-MM-dd") === format(end, "yyyy-MM-dd");
  return `${startStr} → ${format(end, sameDay ? "HH:mm:ss" : "MM-dd HH:mm:ss")}`;
}
