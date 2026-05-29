import { useEffect, useState } from "react";

interface ReportProgressProps {
  /** True while the synthesize mutation is in flight. Drives the ticker. */
  active: boolean;
}

/**
 * Inline progress strip for the (synchronous) AI report generation. No SSE
 * yet — the synthesize endpoint takes 60-180s; this component just gives the
 * user a sense of "yes it's running" via:
 *   - an elapsed-seconds counter (updates every 250ms)
 *   - a rotating phase label that ticks through known stages
 *
 * The phase labels are illustrative, not synced to actual server state. If we
 * later want true sync (streamed LLM tokens via SSE) the same component can
 * accept a `phase` prop and drop the rotation.
 */
const PHASES = [
  { atSec: 0, label: "Collecting benchmark data…" },
  { atSec: 3, label: "Calling LLM provider…" },
  { atSec: 12, label: "Writing Executive Summary…" },
  { atSec: 25, label: "Writing Method + Results…" },
  { atSec: 55, label: "Writing Caveats + Advice…" },
  { atSec: 80, label: "Running style lint…" },
  { atSec: 100, label: "Finalizing — almost there…" },
] as const;

export function ReportProgress({ active }: ReportProgressProps) {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!active) {
      setElapsedMs(0);
      return;
    }
    const start = performance.now();
    const id = window.setInterval(() => setElapsedMs(performance.now() - start), 250);
    return () => window.clearInterval(id);
  }, [active]);

  if (!active) return null;

  const elapsedSec = Math.floor(elapsedMs / 1000);
  const phase = [...PHASES].reverse().find((p) => elapsedSec >= p.atSec) ?? PHASES[0];

  // Soft "expected" envelope: avg ~75s, max ~180s. Show progress against avg
  // (clamped to 95%) so the bar doesn't sit at 100% if it runs long.
  const expectedSec = 75;
  const pct = Math.min(95, Math.round((elapsedSec / expectedSec) * 95));

  return (
    <div className="mt-2 space-y-1.5 text-xs">
      <div className="flex items-baseline justify-between text-muted-foreground">
        <span className="font-medium text-foreground">{phase.label}</span>
        <span className="font-mono">
          {elapsedSec}s<span className="ml-1 opacity-60">/ ~{expectedSec}s avg</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-violet-500 transition-[width] duration-250 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
