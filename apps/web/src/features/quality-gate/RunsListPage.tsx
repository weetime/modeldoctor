import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { RelativeTime } from "@/components/common/relative-time";
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
import type { EvaluationRun, GateResult, ListRunsQuery, RunStatus } from "@modeldoctor/contracts";
import { ArrowRight, History, MoreHorizontal, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { GateStatusBadge } from "./components/GateStatusBadge";
import { RunsListFilters } from "./components/RunsListFilters";
import { useDeleteRun, useRuns } from "./queries";

export function RunsListPage() {
  const nav = useNavigate();
  const { t } = useTranslation("quality-gate");
  const { t: tCommon } = useTranslation("common");
  const [searchParams, setSearchParams] = useSearchParams();

  const query: Partial<ListRunsQuery> = useMemo(() => {
    const get = (k: string) => searchParams.get(k) ?? undefined;
    const q: Partial<ListRunsQuery> = {};
    const status = get("status");
    if (status) q.status = status as RunStatus;
    const gateResult = get("gateResult");
    if (gateResult) q.gateResult = gateResult as GateResult;
    const evaluationId = get("evaluationId");
    if (evaluationId) q.evaluationId = evaluationId;
    const endpointId = get("endpointId");
    if (endpointId) q.endpointId = endpointId;
    const search = get("search");
    if (search) q.search = search;
    const createdAfter = get("createdAfter");
    if (createdAfter) q.createdAfter = createdAfter;
    const createdBefore = get("createdBefore");
    if (createdBefore) q.createdBefore = createdBefore;
    return q;
  }, [searchParams]);

  function patchQuery(next: Partial<ListRunsQuery>) {
    const sp = new URLSearchParams();
    if (next.status) sp.set("status", next.status);
    if (next.gateResult) sp.set("gateResult", next.gateResult);
    if (next.evaluationId) sp.set("evaluationId", next.evaluationId);
    if (next.endpointId) sp.set("endpointId", next.endpointId);
    if (next.search) sp.set("search", next.search);
    if (next.createdAfter) sp.set("createdAfter", next.createdAfter);
    if (next.createdBefore) sp.set("createdBefore", next.createdBefore);
    setSearchParams(sp);
  }

  const { data, isLoading } = useRuns(query);
  const del = useDeleteRun();
  const items = data?.items ?? [];
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const clearSelection = () => setSelected(new Set());
  const compareSelected = () => {
    const ids = Array.from(selected).join(",");
    nav(`/benchmarks/compare/saved/new?evaluationRunIds=${ids}`);
  };

  return (
    <>
      <PageHeader
        title={t("runs.title")}
        subtitle={t("runs.subtitle")}
        rightSlot={
          <Button onClick={() => nav("/quality-gate/runs/new")}>{t("runs.create")}</Button>
        }
      />
      <div className="px-8 py-6 space-y-4">
        <RunsListFilters query={query} onChange={patchQuery} />

        {selected.size > 0 && (
          <div className="sticky top-0 z-10 bg-card border rounded-md p-2 flex items-center justify-between">
            <span className="text-sm">{t("runs.selection.count", { count: selected.size })}</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={selected.size < 2}
                onClick={compareSelected}
                title={selected.size < 2 ? t("runs.selection.needTwo") : undefined}
              >
                {t("runs.selection.compareSelected")} ({selected.size})
              </Button>
              <Button size="sm" variant="ghost" onClick={clearSelection}>
                {t("runs.selection.clear")}
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div
            role="status"
            aria-label="loading"
            className="h-64 animate-pulse rounded-md border border-border bg-muted/30"
          />
        ) : items.length === 0 ? (
          <EmptyState icon={History} title={t("runs.empty")} />
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="w-32">{t("evaluations.runsCol.id")}</TableHead>
                  <TableHead>{t("evaluations.runsCol.evaluation")}</TableHead>
                  <TableHead>{t("evaluations.runsCol.endpoint")}</TableHead>
                  <TableHead className="w-32">{t("evaluations.runsCol.status")}</TableHead>
                  <TableHead className="w-32">{t("runs.passRate.label")}</TableHead>
                  <TableHead className="w-48">{t("evaluations.runsCol.createdAt")}</TableHead>
                  <TableHead className="w-56 text-center">{tCommon("table.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link
                        className="font-mono hover:text-primary hover:underline"
                        to={`/quality-gate/runs/${r.id}`}
                      >
                        {r.id.slice(0, 12)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {r.evaluation ? (
                        <Link
                          className="hover:text-primary hover:underline"
                          to={`/quality-gate/evaluations/${r.evaluation.id}`}
                        >
                          {r.evaluation.name}
                        </Link>
                      ) : (
                        <span className="italic text-muted-foreground">
                          {t("evaluations.runsCol.evaluationMissing")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.endpointA ? (
                        <div className="flex flex-col">
                          <span className="text-sm">{r.endpointA.model}</span>
                          <span className="text-xs text-muted-foreground">
                            {r.endpointA.name}
                            {r.endpointB ? ` · vs ${r.endpointB.model}` : ""}
                          </span>
                        </div>
                      ) : (
                        <span className="italic text-muted-foreground">
                          {t("evaluations.runsCol.endpointMissing")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <GateStatusBadge status={r.status} gateResult={r.gateResult} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      <PassRateCell run={r} />
                    </TableCell>
                    <TableCell>
                      <RelativeTime date={r.createdAt} />
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="inline-flex items-center gap-1">
                        <Button asChild variant="ghost" size="sm" className="gap-1">
                          <Link to={`/quality-gate/runs/${r.id}`}>
                            <ArrowRight className="h-4 w-4" />
                            <span>{t("detail.actions.detail")}</span>
                          </Link>
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
                              onClick={() => setPendingDeleteId(r.id)}
                              className="gap-2 text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                              {t("detail.delete.button")}
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
      </div>

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("detail.delete.title", { name: pendingDeleteId?.slice(0, 12) ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("detail.delete.descriptionRun")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("detail.delete.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDeleteId) del.mutate(pendingDeleteId);
                setPendingDeleteId(null);
              }}
            >
              {t("detail.delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PassRateCell({ run }: { run: EvaluationRun }) {
  const { t } = useTranslation("quality-gate");
  if (run.status === "COMPLETED" && run.aggregateMetrics) {
    const passRate = run.aggregateMetrics.passRateA;
    const passed = Math.round(passRate * run.totalSamples);
    return (
      <span>
        {t("runs.passRate.completed", {
          passed,
          total: run.totalSamples,
          pct: `${(passRate * 100).toFixed(1)}%`,
        })}
      </span>
    );
  }
  if (run.status === "RUNNING" || run.status === "PENDING") {
    return (
      <span className="text-muted-foreground">
        {t("runs.passRate.running", {
          processed: run.processedSamples,
          total: run.totalSamples,
        })}
      </span>
    );
  }
  return <span className="text-muted-foreground">{t("runs.passRate.unknown")}</span>;
}
