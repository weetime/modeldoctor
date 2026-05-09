import type { EngineMetricsPanelResult, PanelUnit } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { formatPanelValue } from "./format-unit.js";

export interface StatPanelProps {
  label: string;
  unit: PanelUnit;
  series: EngineMetricsPanelResult["series"];
  unavailable: boolean;
  reason?: EngineMetricsPanelResult["reason"];
  thresholds?: Array<{ at: number; severity: "ok" | "warn" | "crit" }>;
}

function pickColor(
  v: number,
  thresholds?: StatPanelProps["thresholds"],
): "ok" | "warn" | "crit" | null {
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

export function StatPanel({
  label,
  unit,
  series,
  unavailable,
  reason,
  thresholds,
}: StatPanelProps) {
  const { t } = useTranslation("engine-metrics");
  const latest = series.flatMap((s) => s.samples).at(-1);
  const value = latest?.[1] ?? null;
  const severity = value != null ? pickColor(value, thresholds) : null;
  const colorClass = severity ? CLASS_BY_SEVERITY[severity] : "text-foreground";

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      {unavailable ? (
        <div className="mt-1 text-sm italic text-muted-foreground">
          {t(`unavailable.${reason ?? "noData"}`, { defaultValue: t("unavailable.noData") })}
        </div>
      ) : (
        <div className={`mt-1 text-2xl font-semibold ${colorClass}`}>
          {formatPanelValue(value, unit)}
        </div>
      )}
    </div>
  );
}
