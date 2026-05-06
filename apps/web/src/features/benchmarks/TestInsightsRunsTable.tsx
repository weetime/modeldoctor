import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Benchmark } from "@modeldoctor/contracts";
import { formatDistanceToNow } from "date-fns";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { readErrorRate, readP95Latency } from "./compare/metrics";
import { StatusBadge } from "./status-display";

interface Props {
  runs: Benchmark[];
}

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  return n.toFixed(digits);
}

/**
 * Read-only run history for the test-insights detail page. Same data
 * the BenchmarkListShell shows but without selection / actions / compare —
 * users come here to inspect, not manage.
 */
export function TestInsightsRunsTable({ runs }: Props) {
  const { t } = useTranslation("benchmarks");
  if (runs.length === 0) {
    return (
      <div
        role="status"
        className="flex h-32 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground"
      >
        {t("reports.detail.runs.empty")}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("reports.detail.runs.columns.name")}</TableHead>
            <TableHead>{t("reports.detail.runs.columns.createdAt")}</TableHead>
            <TableHead>{t("reports.detail.runs.columns.tool")}</TableHead>
            <TableHead>{t("reports.detail.runs.columns.status")}</TableHead>
            <TableHead className="text-right">
              {t("reports.detail.runs.columns.p95")}
            </TableHead>
            <TableHead className="text-right">
              {t("reports.detail.runs.columns.errorRate")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((b) => (
            <TableRow key={b.id}>
              <TableCell className="font-medium">
                <Link
                  to={`/benchmarks/${b.id}`}
                  className="hover:text-primary hover:underline"
                >
                  {b.name}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDistanceToNow(new Date(b.createdAt), { addSuffix: true })}
              </TableCell>
              <TableCell>
                <Badge variant="default">{b.tool}</Badge>
              </TableCell>
              <TableCell>
                <StatusBadge status={b.status} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtNum(readP95Latency(b.summaryMetrics))}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtNum(readErrorRate(b.summaryMetrics), 4)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
