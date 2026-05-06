import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCreateTemplate } from "@/features/benchmark-templates/queries";
import type {
  Benchmark,
  BenchmarkStatus,
  BenchmarkTool,
  ListBenchmarksQuery,
} from "@modeldoctor/contracts";
import { migrateVegetaParams } from "@modeldoctor/tool-adapters/schemas";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  Copy as CopyIcon,
  History as HistoryIcon,
  MoreHorizontal,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { BenchmarkListFilters } from "./BenchmarkListFilters";
import { readErrorRate, readP95Latency } from "./compare/metrics";
import { useBenchmarkList, useCreateBenchmark, useDeleteBenchmark } from "./queries";
import { SCENARIOS, type ScenarioId } from "./scenarios";
import { StatusBadge } from "./status-display";

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  return n.toFixed(digits);
}

interface BenchmarkListShellProps {
  scenario: ScenarioId;
}

export function BenchmarkListShell({ scenario }: BenchmarkListShellProps) {
  const { t } = useTranslation("benchmarks");
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
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const deleteBenchmark = useDeleteBenchmark();
  const createBenchmark = useCreateBenchmark();
  const createTemplate = useCreateTemplate();
  const navigate = useNavigate();

  async function handleRerunRow(b: Benchmark) {
    if (!b.connectionId) {
      toast.error(t("detail.rerun.connectionMissingTooltip"));
      return;
    }
    const trimmed = b.name.length > 120 ? b.name.slice(0, 120) : b.name;
    const newName = `${trimmed} (rerun)`;
    try {
      const next = await createBenchmark.mutateAsync({
        tool: b.tool,
        scenario: b.scenario,
        connectionId: b.connectionId,
        name: newName,
        description: b.description ?? undefined,
        params:
          b.tool === "vegeta"
            ? (migrateVegetaParams(
                b.params as Parameters<typeof migrateVegetaParams>[0],
                b.connection?.model ?? null,
              ) as unknown as Record<string, unknown>)
            : b.params,
      });
      toast.success(t("detail.rerun.success", { name: next.name }));
      navigate(`/benchmarks/${next.id}`);
    } catch (e) {
      toast.error((e as Error).message || t("detail.rerun.errors.generic"));
    }
  }

  async function handleSaveAsTemplate(b: Benchmark) {
    const trimmed = b.name.length > 90 ? b.name.slice(0, 90) : b.name;
    const newName = `${trimmed} (template)`;
    try {
      const next = await createTemplate.mutateAsync({
        name: newName,
        description: b.description ?? undefined,
        scenario: b.scenario,
        tool: b.tool,
        config: b.params as Record<string, unknown>,
        tags: [],
        isOfficial: false,
      });
      toast.success(t("rowActions.saveAsTemplate.success", { name: next.name }));
    } catch (e) {
      toast.error((e as Error).message || t("rowActions.saveAsTemplate.errors.generic"));
    }
  }

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
                  <TableHead className="w-56 text-center">{t("columns.actions")}</TableHead>
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
                    <TableCell className="font-medium">
                      <Link
                        to={`/benchmarks/${benchmark.id}`}
                        className="hover:text-primary hover:underline"
                      >
                        {benchmark.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDistanceToNow(new Date(benchmark.createdAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      <Badge variant="default">{benchmark.tool}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {benchmark.connection ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-foreground">{benchmark.connection.name}</span>
                              <span className="text-xs text-muted-foreground/70">
                                {benchmark.connection.model}
                              </span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="font-mono text-xs">
                            {benchmark.connection.baseUrl}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={benchmark.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(readP95Latency(benchmark.summaryMetrics))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(readErrorRate(benchmark.summaryMetrics), 4)}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="inline-flex items-center gap-1">
                        <Button asChild variant="ghost" size="sm" className="gap-1">
                          <Link to={`/benchmarks/${benchmark.id}`}>
                            <ArrowRight className="h-4 w-4" />
                            <span>{t("rowActions.viewDetail")}</span>
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1"
                          onClick={() => handleRerunRow(benchmark)}
                          disabled={benchmark.connectionId === null || createBenchmark.isPending}
                        >
                          <RefreshCw className="h-4 w-4" />
                          <span>{t("rowActions.rerun")}</span>
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={t("rowActions.more")}
                              title={t("rowActions.more")}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => handleSaveAsTemplate(benchmark)}
                              disabled={createTemplate.isPending}
                              className="gap-2"
                            >
                              <CopyIcon className="h-4 w-4" />
                              {t("rowActions.saveAsTemplate.label")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setPendingDeleteId(benchmark.id)}
                              className="gap-2 text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                              {t("rowActions.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
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

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("detail.delete.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("detail.delete.confirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("detail.baseline.dialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingDeleteId) return;
                deleteBenchmark.mutate(pendingDeleteId, {
                  onSuccess: () => {
                    setPendingDeleteId(null);
                    toast.success(t("detail.delete.success"));
                  },
                  onError: () => {
                    toast.error(t("detail.delete.errors.generic"));
                  },
                });
              }}
              disabled={deleteBenchmark.isPending}
            >
              {t("detail.delete.confirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
