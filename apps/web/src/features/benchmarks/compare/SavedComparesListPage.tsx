import type { SavedCompare } from "@modeldoctor/contracts";
import { ArrowRight, FileText, ListChecks, MoreHorizontal, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useDeleteSavedCompare, useSavedCompares } from "./queries";

/** Stage labels are a record keyed by benchmarkId; preserve insertion order
 * (baseline-first by construction) and de-dupe in case two runs share a label.
 * The API response is type-cast, not runtime-validated, so guard against a
 * null/corrupt `stageLabels` (Object.values(null) would throw) and drop any
 * empty labels rather than render blank chips. */
function stageLabelList(item: SavedCompare): string[] {
  if (!item.stageLabels) return [];
  return [...new Set(Object.values(item.stageLabels).filter(Boolean))];
}

export function SavedComparesListPage() {
  const { t } = useTranslation("benchmarks");
  const { t: tCommon } = useTranslation("common");
  const { data, isLoading } = useSavedCompares();
  const del = useDeleteSavedCompare();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const items = data?.items ?? [];

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return items;
    return items.filter((item) => {
      if (item.name.toLowerCase().includes(ql)) return true;
      if (item.clientName?.toLowerCase().includes(ql)) return true;
      return stageLabelList(item).some((label) => label.toLowerCase().includes(ql));
    });
  }, [items, q]);

  return (
    <>
      <PageHeader title={t("savedCompare.list.title")} subtitle={t("savedCompare.list.subtitle")} />
      <div className="space-y-6 px-8 py-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("savedCompare.list.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>

        {isLoading ? (
          <div
            role="status"
            aria-label="loading"
            className="h-64 animate-pulse rounded-md border border-border bg-muted/30"
          />
        ) : items.length === 0 ? (
          <EmptyState icon={ListChecks} title={t("savedCompare.list.empty")} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Search} title={t("savedCompare.list.noResults")} />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item) => {
              const hasReport = item.narrativeAt != null;
              const stages = stageLabelList(item);
              return (
                <Card key={item.id} className="flex flex-col">
                  <CardHeader className="space-y-2 pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        to={`/reports/${item.id}`}
                        className="font-semibold leading-tight hover:text-primary hover:underline"
                      >
                        {item.name}
                      </Link>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="-mr-1 -mt-1 h-7 w-7 shrink-0"
                            aria-label={tCommon("table.actions")}
                            title={tCommon("table.actions")}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => setPendingDeleteId(item.id)}
                            className="gap-2 text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                            {tCommon("actions.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant={hasReport ? "success" : "outline"}
                        className="gap-1 text-[10px]"
                      >
                        <FileText className="h-3 w-3" />
                        {hasReport
                          ? t("savedCompare.list.reportReady")
                          : t("savedCompare.list.reportPending")}
                      </Badge>
                      {item.classification && (
                        <Badge variant="default" className="text-[10px]">
                          {t(`savedCompare.classification.${item.classification}`)}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-3 text-sm">
                    {stages.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {stages.map((label) => (
                          <Badge key={label} variant="outline" className="text-[10px] font-normal">
                            {label}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span className="tabular-nums">
                        {t("savedCompare.list.runs", { count: item.benchmarkIds.length })}
                      </span>
                      {item.clientName && (
                        <>
                          <span>·</span>
                          <span className="truncate">{item.clientName}</span>
                        </>
                      )}
                      <span>·</span>
                      <RelativeTime date={item.createdAt} />
                    </div>
                    <div className="mt-auto pt-1">
                      <Button asChild variant="outline" size="sm" className="gap-1">
                        <Link to={`/reports/${item.id}`}>
                          {tCommon("actions.detail")}
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
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
            <AlertDialogTitle>{t("savedCompare.detail.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("savedCompare.detail.deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("savedCompare.dialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDeleteId) del.mutate(pendingDeleteId);
                setPendingDeleteId(null);
              }}
            >
              {t("savedCompare.detail.deleteTitle")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
