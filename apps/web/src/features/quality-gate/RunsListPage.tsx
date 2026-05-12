import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDeleteRun, useRuns } from "./queries";
import { GateStatusBadge } from "./components/GateStatusBadge";

export function RunsListPage() {
  const nav = useNavigate();
  const { t } = useTranslation("quality-gate");
  const { data, isLoading } = useRuns({});
  const del = useDeleteRun();
  const items = data?.items ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("runs.title")}</h1>
        <Button onClick={() => nav("/quality-gate/runs/new")}>{t("runs.create")}</Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">{t("common.loading")}</div>
      ) : items.length === 0 ? (
        <div className="text-muted-foreground">{t("runs.empty")}</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("evaluations.col.name")}</TableHead>
              <TableHead>{t("runs.status.running")}</TableHead>
              <TableHead>{t("evaluations.col.samples")}</TableHead>
              <TableHead>{t("evaluations.col.updatedAt")}</TableHead>
              <TableHead className="text-right">{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link
                    className="text-primary hover:underline"
                    to={`/quality-gate/runs/${r.id}`}
                  >
                    {r.id.slice(0, 12)}
                  </Link>
                </TableCell>
                <TableCell>
                  <GateStatusBadge status={r.status} gateResult={r.gateResult} />
                </TableCell>
                <TableCell>
                  {r.processedSamples}/{r.totalSamples}
                </TableCell>
                <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
                <TableCell className="text-right space-x-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => nav(`/quality-gate/runs/${r.id}`)}
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
