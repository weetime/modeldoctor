import { PageHeader } from "@/components/common/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { ArrowRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { GateStatusBadge } from "./components/GateStatusBadge";
import { useDeleteRun, useRuns } from "./queries";

export function RunsListPage() {
  const nav = useNavigate();
  const { t } = useTranslation("quality-gate");
  const { t: tCommon } = useTranslation("common");
  const { data, isLoading } = useRuns({});
  const del = useDeleteRun();
  const items = data?.items ?? [];

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
      <div className="px-8 py-6 space-y-6">
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
          <div className="text-muted-foreground">{tCommon("table.loading")}</div>
        ) : items.length === 0 ? (
          <div className="text-muted-foreground">{t("runs.empty")}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="w-32">{t("evaluations.runsCol.id")}</TableHead>
                <TableHead>{t("evaluations.runsCol.evaluation")}</TableHead>
                <TableHead>{t("evaluations.runsCol.endpoint")}</TableHead>
                <TableHead className="w-32">{t("evaluations.runsCol.status")}</TableHead>
                <TableHead className="w-20">{t("evaluations.runsCol.progress")}</TableHead>
                <TableHead className="w-48">{t("evaluations.runsCol.createdAt")}</TableHead>
                <TableHead className="w-44 text-right">{tCommon("table.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
                  </TableCell>
                  <TableCell>
                    <Link
                      className="font-mono text-primary hover:underline"
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
                    {r.processedSamples}/{r.totalSamples}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button asChild variant="ghost" size="sm" className="gap-1">
                        <Link to={`/quality-gate/runs/${r.id}`}>
                          <ArrowRight className="h-4 w-4" />
                          <span>{t("detail.actions.detail")}</span>
                        </Link>
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="gap-1 text-destructive">
                            <Trash2 className="h-4 w-4" />
                            <span>{t("detail.delete.button")}</span>
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {t("detail.delete.title", { name: r.id.slice(0, 12) })}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {t("detail.delete.descriptionRun")}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("detail.delete.cancel")}</AlertDialogCancel>
                            <AlertDialogAction onClick={() => del.mutate(r.id)}>
                              {t("detail.delete.confirm")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
