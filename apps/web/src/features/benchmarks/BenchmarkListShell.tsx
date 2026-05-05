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
import type { BenchmarkStatus, BenchmarkTool, ListBenchmarksQuery } from "@modeldoctor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { History as HistoryIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { BenchmarkListFilters } from "./BenchmarkListFilters";
import { readErrorRate, readP95Latency } from "./compare/metrics";
import { benchmarkKeys, useBenchmarkList } from "./queries";
import { SCENARIOS, type ScenarioId } from "./scenarios";

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  return n.toFixed(digits);
}

interface BenchmarkListShellProps {
  scenario: ScenarioId;
}

export function BenchmarkListShell({ scenario }: BenchmarkListShellProps) {
  const { t } = useTranslation("benchmarks");
  const qc = useQueryClient();
  const cfg = SCENARIOS[scenario];

  const [searchParams, setSearchParams] = useSearchParams();
  // Cursor is intentionally NOT stored in the URL — useInfiniteQuery owns
  // pagination state. Putting cursor in the URL would change the query key on
  // every "Load more" click and replace the list instead of appending.
  const query: Partial<ListBenchmarksQuery> = useMemo(() => {
    // Always pin the scenario filter from the page prop. Users cannot widen
    // the view across scenarios from a scenario-specific page; that's the
    // whole point of the per-scenario list.
    const q: Partial<ListBenchmarksQuery> = { limit: 20, scenario };
    const get = (k: string) => searchParams.get(k) ?? undefined;
    const tool = get("tool");
    // Defensive: only honor tool query param when it's a tool the scenario
    // actually allows. A stale ?tool=vegeta on /benchmarks/inference would
    // otherwise produce an empty list with no obvious cause.
    if (tool && (cfg.tools as readonly string[]).includes(tool)) {
      q.tool = tool as BenchmarkTool;
    }
    const status = get("status");
    if (status) q.status = status as BenchmarkStatus;
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
  }, [searchParams, scenario, cfg.tools]);

  function patchQuery(next: Partial<ListBenchmarksQuery>) {
    const sp = new URLSearchParams();
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
  const navigate = useNavigate();

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useBenchmarkList(query);
  const items = useMemo(() => (data?.pages ?? []).flatMap((p) => p.items), [data]);

  // Derive selected-Benchmark tools to gate the Compare button:
  // - selection size 0 or 1 → disabled (need 2)
  // - selection ≥2 same tool → enabled
  // - selection ≥2 mixed tools → disabled (mixed tools tooltip)
  const selectedTools = useMemo(() => {
    const tools = new Map<string, number>();
    for (const id of selected) {
      const benchmark = items.find((r) => r.id === id);
      if (!benchmark) continue;
      tools.set(benchmark.tool, (tools.get(benchmark.tool) ?? 0) + 1);
    }
    return tools;
  }, [selected, items]);

  const compareDisabledReason: "needTwo" | "mixedTools" | null =
    selected.size < 2 ? "needTwo" : selectedTools.size > 1 ? "mixedTools" : null;

  const isFiltered = useMemo(
    () =>
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
        title={cfg.label}
        subtitle={cfg.description}
        rightSlot={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: benchmarkKeys.lists() })}
            >
              {t("retry")}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    size="sm"
                    disabled={compareDisabledReason !== null}
                    onClick={() => {
                      if (compareDisabledReason !== null) return;
                      navigate(`/benchmarks/compare?ids=${[...selected].join(",")}`);
                    }}
                  >
                    {t("compareButton", { n: selected.size })}
                  </Button>
                </span>
              </TooltipTrigger>
              {compareDisabledReason !== null && (
                <TooltipContent>
                  {compareDisabledReason === "needTwo"
                    ? t("compareDisabledNeedTwo")
                    : t("compareDisabledMixedTools", {
                        summary: [...selectedTools.entries()]
                          .map(([tool, n]) => `${tool} × ${n}`)
                          .join(" + "),
                      })}
                </TooltipContent>
              )}
            </Tooltip>
            <Button asChild size="sm">
              <Link to={`/benchmarks/new?scenario=${scenario}`}>{t("actions.new")}</Link>
            </Button>
          </div>
        }
      />

      <div className="space-y-4 px-8 py-6">
        <BenchmarkListFilters
          query={query}
          onChange={patchQuery}
          availableTools={cfg.tools as readonly BenchmarkTool[]}
        />

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
                  <TableHead>{t("columns.name")}</TableHead>
                  <TableHead>{t("columns.createdAt")}</TableHead>
                  <TableHead>{t("columns.tool")}</TableHead>
                  <TableHead>{t("columns.connection")}</TableHead>
                  <TableHead>{t("columns.status")}</TableHead>
                  <TableHead className="text-right">{t("columns.p95")}</TableHead>
                  <TableHead className="text-right">{t("columns.errorRate")}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((benchmark) => (
                  <TableRow key={benchmark.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(benchmark.id)}
                        onCheckedChange={(c) => toggleRow(benchmark.id, c === true)}
                        aria-label={`select ${benchmark.id}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{benchmark.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDistanceToNow(new Date(benchmark.createdAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      <Badge variant="default">{benchmark.tool}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {benchmark.connection?.name ?? "—"}
                    </TableCell>
                    <TableCell>{benchmark.status}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(readP95Latency(benchmark.summaryMetrics))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(readErrorRate(benchmark.summaryMetrics), 4)}
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/benchmarks/${benchmark.id}`}
                        className="text-primary hover:underline"
                      >
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
