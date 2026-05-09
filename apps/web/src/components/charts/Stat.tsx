import type { PanelUnit } from "@modeldoctor/contracts";
import { ChartFrame, useChartTokens } from "./_shared";
import { formatPanelValue } from "./format-unit";

export interface StatProps {
  ariaLabel: string;
  value: number | null;
  unit: PanelUnit;
  thresholds?: Array<{ at: number; severity: "ok" | "warn" | "crit" }>;
  loading?: boolean;
  empty?: boolean | string;
  height?: number;
}

function pickColor(v: number, thresholds?: StatProps["thresholds"]): "ok" | "warn" | "crit" | null {
  if (!thresholds || thresholds.length === 0) return null;
  const sorted = [...thresholds].sort((a, b) => b.at - a.at);
  for (const t of sorted) {
    if (v >= t.at) return t.severity;
  }
  return sorted[sorted.length - 1].severity;
}

const CLASS_BY_SEVERITY = {
  ok: "text-emerald-500",
  warn: "text-amber-500",
  crit: "text-rose-500",
} as const;

export function Stat({
  ariaLabel,
  value,
  unit,
  thresholds,
  loading,
  empty,
  height = 120,
}: StatProps): JSX.Element {
  // Consume tokens so the component re-renders when the theme changes.
  // We don't read individual token fields here — the color classes come from
  // Tailwind/shadcn variables which also change on theme switch. The call
  // ensures consistent re-render timing with ECharts-based siblings.
  useChartTokens();

  const severity = value != null ? pickColor(value, thresholds) : null;
  const colorClass = severity ? CLASS_BY_SEVERITY[severity] : "text-foreground";

  const isEmpty = empty ?? value == null;

  return (
    <ChartFrame ariaLabel={ariaLabel} height={height} loading={loading} empty={isEmpty}>
      <div className="flex h-full items-center justify-center" aria-label={ariaLabel}>
        <div className={`text-2xl font-semibold ${colorClass}`}>
          {formatPanelValue(value, unit)}
        </div>
      </div>
    </ChartFrame>
  );
}
