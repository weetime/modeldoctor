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
import { GateStatusBadge } from "./components/GateStatusBadge";
import { useDeleteRun, useRuns } from "./queries";

export function RunsListPage() {
  const nav = useNavigate();
  const { t } = useTranslation("quality-gate");
  const { t: tCommon } = useTranslation("common");
  const { data, isLoading } = useRuns({});
  const del = useDeleteRun();
  const items = data?.items ?? [];

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
        {isLoading ? (
          <div className="text-muted-foreground">{tCommon("table.loading")}</div>
        ) : items.length === 0 ? (
          <div className="text-muted-foreground">{t("runs.empty")}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("evaluations.runsCol.id")}</TableHead>
                <TableHead>{t("evaluations.runsCol.status")}</TableHead>
                <TableHead>{t("evaluations.runsCol.progress")}</TableHead>
                <TableHead>{t("evaluations.runsCol.createdAt")}</TableHead>
                <TableHead className="text-right">{tCommon("table.actions")}</TableHead>
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
    </>
  );
}
