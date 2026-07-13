// apps/web/src/features/insights/MatrixGrid.tsx
import type { InsightsMatrixResponse, MatrixCell } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

interface Props {
  data: InsightsMatrixResponse;
  onRowClick?: (endpointId: string) => void;
  onDimClick?: (dimKey: string) => void;
}

// Same numeric thresholds as InsightsDetailPage's severityClass (>=85 emerald,
// >=60 amber, <60 rose) — kept as a chip (bg + text) rather than text-only
// since a coverage grid needs to be scannable at a glance.
function chipClass(score: number | null): string {
  if (score == null) return "bg-muted text-muted-foreground";
  if (score >= 85)
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
  if (score >= 60) return "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300";
  return "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300";
}

function cellKey(endpointId: string, dimKey: string): string {
  return `${endpointId}::${dimKey}`;
}

function cellTitle(cell: MatrixCell): string | undefined {
  const parts: string[] = [];
  if (cell.band) parts.push(cell.band);
  if (cell.nativeMetric)
    parts.push(`${cell.nativeMetric.kind} ${cell.nativeMetric.value}${cell.nativeMetric.unit}`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function MatrixGrid({ data, onRowClick, onDimClick }: Props) {
  const { t } = useTranslation("insights");

  const cellsByKey = new Map<string, MatrixCell>();
  for (const cell of data.cells) {
    cellsByKey.set(cellKey(cell.endpointId, cell.dimKey), cell);
  }

  function dimLabel(key: string, fallback: string): string {
    if (data.aggregate === "scenario") {
      return t(`detail.scenario.${key}`, { defaultValue: fallback });
    }
    return fallback;
  }

  function detailHref(endpointId: string, dimKey: string): string {
    return data.aggregate === "scenario"
      ? `/insights/${endpointId}?scenario=${encodeURIComponent(dimKey)}`
      : `/insights/${endpointId}`;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("matrix.columns.endpoint", { defaultValue: "Endpoint" })}
            </th>
            {data.dimensions.map((dim) => (
              <th
                key={dim.key}
                className="whitespace-nowrap p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                <button
                  type="button"
                  onClick={() => onDimClick?.(dim.key)}
                  className="hover:text-foreground hover:underline focus:outline-none focus-visible:underline"
                >
                  {dimLabel(dim.key, dim.label)}
                </button>
                <sub className="ml-1 text-[10px] font-normal normal-case text-muted-foreground/70">
                  {dim.count}
                </sub>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.endpoints.map((endpoint) => (
            <tr
              key={endpoint.id}
              className="border-b border-border/60 last:border-b-0 hover:bg-accent/40"
              onClick={() => onRowClick?.(endpoint.id)}
            >
              <td className="p-2 align-top">
                <Link
                  to={`/insights/${endpoint.id}`}
                  className="font-medium text-foreground hover:underline"
                >
                  {endpoint.model}
                </Link>
                <div className="text-xs text-muted-foreground">{endpoint.name}</div>
              </td>
              {data.dimensions.map((dim) => {
                const cell = cellsByKey.get(cellKey(endpoint.id, dim.key));
                if (!cell) {
                  return <td key={dim.key} className="p-2" />;
                }
                return (
                  <td key={dim.key} className="p-2 align-top">
                    <Link
                      to={detailHref(endpoint.id, dim.key)}
                      title={cellTitle(cell)}
                      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold tabular-nums transition-opacity hover:opacity-80 ${chipClass(
                        cell.score,
                      )}`}
                    >
                      {cell.score ?? "—"}
                      <span className="text-[10px] font-normal opacity-70">×{cell.runs}</span>
                    </Link>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
