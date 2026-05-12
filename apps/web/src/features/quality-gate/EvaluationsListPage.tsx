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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useDeleteEvaluation, useEvaluations } from "./queries";

export function EvaluationsListPage() {
  const nav = useNavigate();
  const { t } = useTranslation("quality-gate");
  const { data, isLoading } = useEvaluations();
  const del = useDeleteEvaluation();

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("evaluations.title")}</h1>
        <Button onClick={() => nav("/quality-gate/evaluations/new")}>
          {t("evaluations.create")}
        </Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">{t("common.loading")}</div>
      ) : !data || data.length === 0 ? (
        <div className="text-muted-foreground">{t("evaluations.empty")}</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("evaluations.col.name")}</TableHead>
              <TableHead>{t("evaluations.col.samples")}</TableHead>
              <TableHead>{t("evaluations.col.updatedAt")}</TableHead>
              <TableHead className="text-right">{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <Link
                    className="text-primary hover:underline"
                    to={`/quality-gate/evaluations/${e.id}`}
                  >
                    {e.name}
                  </Link>
                </TableCell>
                <TableCell>{e.totalSamples}</TableCell>
                <TableCell>{new Date(e.updatedAt).toLocaleString()}</TableCell>
                <TableCell className="text-right space-x-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => nav(`/quality-gate/evaluations/${e.id}`)}
                  >
                    {t("detail.actions.detail")}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-destructive">
                        {t("detail.delete.button")}
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
