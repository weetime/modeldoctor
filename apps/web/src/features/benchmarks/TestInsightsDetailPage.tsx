import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnection } from "@/features/connections/queries";
import type { EndpointReportRange } from "@modeldoctor/contracts";
import { ArrowLeft, SearchX } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { TestInsightsP95Chart } from "./TestInsightsP95Chart";
import { TestInsightsRunsTable } from "./TestInsightsRunsTable";
import { readP95Latency } from "./compare/metrics";
import { useBenchmarkList } from "./queries";

const RANGES: EndpointReportRange[] = ["7d", "30d", "90d"];

function rangeToISO(range: EndpointReportRange): string {
  const days = ({ "7d": 7, "30d": 30, "90d": 90 } as const)[range];
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function TestInsightsDetailPage() {
  const { t } = useTranslation("benchmarks");
  const { connectionId = "" } = useParams<{ connectionId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const range = (searchParams.get("range") ?? "30d") as EndpointReportRange;

  const conn = useConnection(connectionId);
  const list = useBenchmarkList({
    connectionId,
    createdAfter: rangeToISO(range),
    limit: 200,
    scope: "own",
  });

  // Flatten the first page (we ask for limit=200; never paginate).
  const runs = useMemo(() => list.data?.pages[0]?.items ?? [], [list.data]);

  // Tool distribution: counts by tool, sorted by count desc.
  const toolCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of runs) m.set(r.tool, (m.get(r.tool) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [runs]);
  const maxToolCount = toolCounts[0]?.[1] ?? 1;

  // p95 chart points: completed runs with usable metrics, oldest → newest.
  const chartPoints = useMemo(() => {
    return runs
      .filter((r) => r.status === "completed")
      .map((r) => {
        const p95 = readP95Latency(r.summaryMetrics);
        return p95 != null ? { ts: r.createdAt, p95Ms: p95, name: r.name, id: r.id } : null;
      })
      .filter((x): x is { ts: string; p95Ms: number; name: string; id: string } => x !== null)
      .sort((a, b) => +new Date(a.ts) - +new Date(b.ts));
  }, [runs]);

  // Connection 404 → notFound state.
  if ((conn.error as { status?: number } | null)?.status === 404) {
    return (
      <>
        <PageHeader title={connectionId} />
        <div className="px-8 py-6">
          <EmptyState
            icon={SearchX}
            title={t("reports.detail.notFound.title")}
            body={t("reports.detail.notFound.body")}
          />
        </div>
      </>
    );
  }

  if (conn.isLoading) {
    return (
      <>
        <PageHeader title="…" />
        <div className="m-8 h-64 animate-pulse rounded-md border border-border bg-muted/30" />
      </>
    );
  }

  if (!conn.data) return null;

  function setRange(next: EndpointReportRange) {
    const sp = new URLSearchParams(searchParams);
    sp.set("range", next);
    setSearchParams(sp);
  }

  return (
    <>
      <PageHeader
        title={conn.data.name}
        subtitle={`${conn.data.baseUrl} · ${conn.data.model}`}
        rightSlot={
          <div className="flex items-center gap-3">
            <Badge variant="outline">{conn.data.category}</Badge>
            <Select value={range} onValueChange={(v) => setRange(v as EndpointReportRange)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`reports.ranges.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button asChild variant="ghost" size="sm">
              <Link to="/benchmarks/reports">
                <ArrowLeft className="mr-1 h-4 w-4" />
                {t("reports.detail.backToIndex")}
              </Link>
            </Button>
          </div>
        }
      />
      <div className="space-y-6 px-8 py-6">
        {/* Summary + tool distribution (2-col on md+) */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold">{t("reports.detail.summary.title")}</h3>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div>{t("reports.summary.totalRuns", { count: runs.length })}</div>
              {/* No statusCounts here — that's on the index card; the detail
                  page already shows status per row in the table. */}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold">
                {t("reports.detail.summary.toolDistribution")}
              </h3>
            </CardHeader>
            <CardContent className="space-y-2">
              {toolCounts.length === 0 ? (
                <div className="text-sm text-muted-foreground">—</div>
              ) : (
                toolCounts.map(([tool, count]) => (
                  <div key={tool} className="flex items-center gap-3 text-sm">
                    <span className="w-20 truncate font-mono text-xs">{tool}</span>
                    <div className="flex-1 overflow-hidden rounded bg-muted">
                      <div
                        className="h-1.5 bg-primary/60"
                        style={{ width: `${(count / maxToolCount) * 100}%` }}
                      />
                    </div>
                    <span className="w-8 text-right tabular-nums text-xs text-muted-foreground">
                      {count}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* p95 timeseries */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold">{t("reports.detail.timeseries.title")}</h3>
          </CardHeader>
          <CardContent>
            <TestInsightsP95Chart points={chartPoints} />
          </CardContent>
        </Card>

        {/* Run history */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold">{t("reports.detail.runs.title")}</h3>
          </CardHeader>
          <CardContent>
            <TestInsightsRunsTable runs={runs} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
