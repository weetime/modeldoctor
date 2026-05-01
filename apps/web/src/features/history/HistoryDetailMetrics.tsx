import type { Run } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";

export function HistoryDetailMetrics({
  metrics,
}: {
  metrics: Run["summaryMetrics"];
}) {
  const { t } = useTranslation("history");
  if (!metrics || Object.keys(metrics).length === 0) {
    return <p className="text-sm text-muted-foreground">{t("detail.metrics.empty")}</p>;
  }
  const entries = Object.entries(metrics as Record<string, unknown>);
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-mono text-xs">{renderValue(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
