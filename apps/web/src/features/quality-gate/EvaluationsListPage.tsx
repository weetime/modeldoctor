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
import type { Evaluation } from "@modeldoctor/contracts";
import { ArrowRight, Copy, ListChecks, MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useDeleteEvaluation, useDuplicateEvaluation, useEvaluations } from "./queries";

export function EvaluationsListPage() {
  const nav = useNavigate();
  const { t } = useTranslation("quality-gate");
  const { t: tCommon } = useTranslation("common");
  const { data, isLoading } = useEvaluations();
  const del = useDeleteEvaluation();
  const duplicate = useDuplicateEvaluation();
  const [pendingDelete, setPendingDelete] = useState<Evaluation | null>(null);

  async function handleDuplicate(id: string) {
    try {
      const copy = await duplicate.mutateAsync(id);
      toast.success(t("official.duplicateSuccess", { name: copy.name }));
      nav(`/quality-gate/evaluations/${copy.id}`);
    } catch (err) {
      toast.error(t("official.duplicateError", { message: (err as Error).message }));
    }
  }

  return (
    <>
      <PageHeader
        title={t("evaluations.title")}
        subtitle={t("evaluations.subtitle")}
        rightSlot={
          <Button onClick={() => nav("/quality-gate/evaluations/new")}>
            {t("evaluations.create")}
          </Button>
        }
      />
      <div className="px-8 py-6 space-y-4">
        {isLoading ? (
          <div
            role="status"
            aria-label="loading"
            className="h-64 animate-pulse rounded-md border border-border bg-muted/30"
          />
        ) : !data || data.length === 0 ? (
          <EmptyState icon={ListChecks} title={t("evaluations.empty")} />
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("evaluations.col.name")}</TableHead>
                  <TableHead className="w-24 text-right">{t("evaluations.col.samples")}</TableHead>
                  <TableHead className="w-48">{t("evaluations.col.updatedAt")}</TableHead>
                  <TableHead className="w-56 text-center">{tCommon("table.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Link
                          className="hover:text-primary hover:underline"
                          to={`/quality-gate/evaluations/${e.id}`}
                        >
                          {e.name}
                        </Link>
                        {e.isOfficial && (
                          <Badge variant="outline" className="font-normal">
                            {t("official.badge")}
                          </Badge>
                        )}
                      </div>
                      {e.description && (
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {e.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{e.totalSamples}</TableCell>
                    <TableCell>
                      <RelativeTime date={e.updatedAt} />
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="inline-flex items-center gap-1">
                        <Button asChild variant="ghost" size="sm" className="gap-1">
                          <Link to={`/quality-gate/evaluations/${e.id}`}>
                            <ArrowRight className="h-4 w-4" />
                            <span>{t("detail.actions.detail")}</span>
                          </Link>
                        </Button>
                        {e.isOfficial ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1"
                            disabled={duplicate.isPending}
                            onClick={() => handleDuplicate(e.id)}
                          >
                            <Copy className="h-4 w-4" />
                            <span>{t("official.duplicateButton")}</span>
                          </Button>
                        ) : (
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
                                onClick={() => setPendingDelete(e)}
                                className="gap-2 text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                                {t("detail.delete.button")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
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
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("detail.delete.title", { name: pendingDelete?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("detail.delete.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("detail.delete.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) del.mutate(pendingDelete.id);
                setPendingDelete(null);
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
