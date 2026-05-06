import { useTranslation } from "react-i18next";

interface Props {
  first: number | null;
  last: number | null;
  /** Unit shown after the value(s) (e.g. "ms"). */
  unitSuffix?: string;
}

const REGRESSION_RATIO = 1.05;
const IMPROVEMENT_RATIO = 0.95;

/**
 * Compact "first → last" indicator with an arrow that color-codes the
 * delta. Used in the endpoint-reports cards to flag p95 drift over the
 * report window without pulling in a chart library.
 */
export function TrendIndicator({ first, last, unitSuffix = "" }: Props) {
  const { t } = useTranslation("benchmarks");

  if (first == null && last == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (first == null && last != null) {
    return (
      <span className="font-mono text-sm">
        {fmt(last)}
        {unitSuffix}
      </span>
    );
  }
  if (first != null && last == null) {
    return (
      <span className="font-mono text-sm">
        {fmt(first)}
        {unitSuffix}
      </span>
    );
  }
  // Both non-null at this point — TS guard for the branch.
  if (first == null || last == null) return null;

  const ratio = last / first;
  let kind: "regression" | "improvement" | "stable";
  if (ratio > REGRESSION_RATIO) kind = "regression";
  else if (ratio < IMPROVEMENT_RATIO) kind = "improvement";
  else kind = "stable";

  const arrowSymbol = kind === "regression" ? "▲" : kind === "improvement" ? "▼" : "▬";
  const arrowColor =
    kind === "regression"
      ? "text-destructive"
      : kind === "improvement"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-muted-foreground";

  return (
    <span className="inline-flex items-center gap-1 font-mono text-sm">
      <span>{fmt(first)}</span>
      <span className="text-muted-foreground">→</span>
      <span>{fmt(last)}</span>
      {unitSuffix ? <span className="text-muted-foreground">{unitSuffix}</span> : null}
      <span aria-label={t(`reports.trend.${kind}`)} className={arrowColor}>
        {arrowSymbol}
      </span>
    </span>
  );
}

function fmt(n: number): string {
  // 1 decimal, trims trailing .0 for tighter density.
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1);
}
