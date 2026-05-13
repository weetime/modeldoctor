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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowRight, Copy, Trash2 } from "lucide-react";
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
      <div className="px-8 py-6 space-y-6">
        {isLoading ? (
          <div className="text-muted-foreground">{tCommon("table.loading")}</div>
        ) : !data || data.length === 0 ? (
          <div className="text-muted-foreground">{t("evaluations.empty")}</div>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("evaluations.col.name")}</TableHead>
                  <TableHead className="w-24 text-right">{t("evaluations.col.samples")}</TableHead>
                  <TableHead className="w-48">{t("evaluations.col.updatedAt")}</TableHead>
                  <TableHead className="w-56 text-right">{tCommon("table.actions")}</TableHead>
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
                    <TableCell className="text-muted-foreground">
                      {new Date(e.updatedAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
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
                                  {t("detail.delete.title", { name: e.name })}
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t("detail.delete.description")}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t("detail.delete.cancel")}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => del.mutate(e.id)}>
                                  {t("detail.delete.confirm")}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
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
    </>
  );
}
