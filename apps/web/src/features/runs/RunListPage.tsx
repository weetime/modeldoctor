import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ListRunsQuery, Run, RunKind, RunStatus, RunTool } from "@modeldoctor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { History as HistoryIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { RunListFilters } from "./RunListFilters";
import { runKeys, useRunList } from "./queries";

function readP95(metrics: Run["summaryMetrics"], tool: Run["tool"]): number | null {
  if (!metrics) return null;
  // Tool-specific shape: vegeta stores latencies in nanoseconds, guidellm in
  // milliseconds. Header is "(ms)" so we normalise here. If a tool stores p95
  // elsewhere the cell shows '—'.
  const m = metrics as Record<string, unknown>;
  const latency = m.latencies as { p95?: number } | undefined;
  if (latency?.p95 !== undefined) {
    return tool === "vegeta" ? latency.p95 / 1_000_000 : latency.p95;
  }
  const ttft = (m.tokens as { ttftMs?: { p95?: number } } | undefined)?.ttftMs;
  if (ttft?.p95 !== undefined) return ttft.p95;
  return null;
}

function readErrorRate(metrics: Run["summaryMetrics"]): number | null {
  if (!metrics) return null;
  const m = metrics as Record<string, unknown>;
  if (typeof m.errorRate === "number") return m.errorRate;
  const success = m.success as { rate?: number } | undefined;
  if (typeof success?.rate === "number") return 1 - success.rate;
  return null;
}

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  return n.toFixed(digits);
}

export function RunListPage() {
  const { t } = useTranslation("runs");
  const qc = useQueryClient();

  const [searchParams, setSearchParams] = useSearchParams();
  // Cursor is intentionally NOT stored in the URL — useInfiniteQuery owns
  // pagination state. Putting cursor in the URL would change the query key on
  // every "Load more" click and replace the list instead of appending.
  const query: Partial<ListRunsQuery> = useMemo(() => {
    const q: Partial<ListRunsQuery> = { limit: 20 };
    const get = (k: string) => searchParams.get(k) ?? undefined;
    const kind = get("kind");
    if (kind) q.kind = kind as RunKind;
    const tool = get("tool");
    if (tool) q.tool = tool as RunTool;
    const status = get("status");
    if (status) q.status = status as RunStatus;
    const connectionId = get("connectionId");
    if (connectionId) q.connectionId = connectionId;
    const search = get("search");
    if (search) q.search = search;
    const createdAfter = get("createdAfter");
    if (createdAfter) q.createdAfter = createdAfter;
    const createdBefore = get("createdBefore");
    if (createdBefore) q.createdBefore = createdBefore;
    const baseline = get("baseline");
    if (baseline === "is") q.isBaseline = true;
    if (baseline === "ref") q.referencesBaseline = true;
    return q;
  }, [searchParams]);

  function patchQuery(next: Partial<ListRunsQuery>) {
    const sp = new URLSearchParams();
    if (next.kind !== undefined) sp.set("kind", next.kind);
    if (next.tool !== undefined) sp.set("tool", next.tool);
    if (next.status !== undefined) sp.set("status", next.status);
    if (next.connectionId !== undefined) sp.set("connectionId", next.connectionId);
    if (next.search !== undefined) sp.set("search", next.search);
    if (next.createdAfter !== undefined) sp.set("createdAfter", next.createdAfter);
    if (next.createdBefore !== undefined) sp.set("createdBefore", next.createdBefore);
    if (next.isBaseline) sp.set("baseline", "is");
    else if (next.referencesBaseline) sp.set("baseline", "ref");
    setSearchParams(sp);
  }

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useRunList(query);
  const items = useMemo(() => (data?.pages ?? []).flatMap((p) => p.items), [data]);

  const isFiltered = useMemo(
    () =>
      query.kind !== undefined ||
      query.tool !== undefined ||
      query.status !== undefined ||
      query.connectionId !== undefined ||
      query.search !== undefined ||
      query.createdAfter !== undefined ||
      query.createdBefore !== undefined ||
      query.isBaseline !== undefined ||
      query.referencesBaseline !== undefined,
    [query],
  );

  function toggleRow(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        rightSlot={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: runKeys.lists() })}
            >
              {t("retry")}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button size="sm" disabled={true}>
                    {t("compareButton", { n: selected.size })}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t("compareDisabledTooltip")}</TooltipContent>
            </Tooltip>
          </div>
        }
      />

      <div className="space-y-4 px-8 py-6">
        <RunListFilters query={query} onChange={patchQuery} />

        {isError ? (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between">
              <span>{(error as Error).message || t("errorBanner")}</span>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                {t("retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : isLoading ? (
          <div
            role="status"
            aria-label="loading"
            className="h-64 animate-pulse rounded-md border border-border bg-muted/30"
          />
        ) : items.length === 0 ? (
          isFiltered ? (
            <Alert>
              <AlertDescription>{t("empty.filtered")}</AlertDescription>
            </Alert>
          ) : (
            <EmptyState icon={HistoryIcon} title={t("empty.title")} body={t("empty.description")} />
          )
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>{t("columns.createdAt")}</TableHead>
                  <TableHead>{t("columns.kind")}</TableHead>
                  <TableHead>{t("columns.tool")}</TableHead>
                  <TableHead>{t("columns.connection")}</TableHead>
                  <TableHead>{t("columns.status")}</TableHead>
                  <TableHead className="text-right">{t("columns.p95")}</TableHead>
                  <TableHead className="text-right">{t("columns.errorRate")}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(run.id)}
                        onCheckedChange={(c) => toggleRow(run.id, c === true)}
                        aria-label={`select ${run.id}`}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{run.kind}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="default">{run.tool}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {run.connection?.name ?? "—"}
                    </TableCell>
                    <TableCell>{run.status}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(readP95(run.summaryMetrics, run.tool))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(readErrorRate(run.summaryMetrics), 4)}
                    </TableCell>
                    <TableCell>
                      <Link to={`/runs/${run.id}`} className="text-primary hover:underline">
                        →
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {hasNextPage && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
