import { EmptyState } from "@/components/common/empty-state";
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
import { ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useDeleteSavedCompare, useSavedCompares } from "./queries";

export function SavedComparesListPage() {
  const { t } = useTranslation("benchmarks");
  const { t: tCommon } = useTranslation("common");
  const { data, isLoading } = useSavedCompares();
  const del = useDeleteSavedCompare();

  if (isLoading) {
    return (
      <>
        <PageHeader title={t("savedCompare.list.title")} />
        <div className="m-8 h-32 animate-pulse rounded-md border border-border bg-muted/30" />
      </>
    );
  }

  const items = data?.items ?? [];

  return (
    <>
      <PageHeader title={t("savedCompare.list.title")} />
      <div className="px-8 py-6">
        {items.length === 0 ? (
          <EmptyState icon={ListChecks} title={t("savedCompare.list.empty")} />
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("savedCompare.list.columnName")}</TableHead>
                  <TableHead className="w-20 text-right">
                    {t("savedCompare.list.columnRuns")}
                  </TableHead>
                  <TableHead className="w-48">{t("savedCompare.list.columnCreated")}</TableHead>
                  <TableHead className="w-32 text-right">
                    {t("savedCompare.list.columnActions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link
                        className="text-primary hover:underline"
                        to={`/benchmarks/compare/saved/${item.id}`}
                      >
                        {item.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.benchmarkIds.length}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link to={`/benchmarks/compare/saved/${item.id}`}>
                          {tCommon("actions.detail")}
                        </Link>
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm">
                            {tCommon("actions.delete")}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {t("savedCompare.detail.deleteTitle")}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {t("savedCompare.detail.deleteBody")}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("savedCompare.dialog.cancel")}</AlertDialogCancel>
                            <AlertDialogAction onClick={() => del.mutate(item.id)}>
                              {t("savedCompare.detail.deleteTitle")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
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
