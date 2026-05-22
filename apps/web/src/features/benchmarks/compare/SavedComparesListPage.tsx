import { ArrowRight, ListChecks, MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
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
import { useDeleteSavedCompare, useSavedCompares } from "./queries";

export function SavedComparesListPage() {
  const { t } = useTranslation("benchmarks");
  const { t: tCommon } = useTranslation("common");
  const { data, isLoading } = useSavedCompares();
  const del = useDeleteSavedCompare();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const items = data?.items ?? [];

  return (
    <>
      <PageHeader title={t("savedCompare.list.title")} />
      <div className="px-8 py-6 space-y-4">
        {isLoading ? (
          <div
            role="status"
            aria-label="loading"
            className="h-64 animate-pulse rounded-md border border-border bg-muted/30"
          />
        ) : items.length === 0 ? (
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
                  <TableHead className="w-56 text-center">
                    {t("savedCompare.list.columnActions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      <Link
                        className="hover:text-primary hover:underline"
                        to={`/benchmarks/compare/saved/${item.id}`}
                      >
                        {item.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.benchmarkIds.length}
                    </TableCell>
                    <TableCell>
                      <RelativeTime date={item.createdAt} />
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="inline-flex items-center gap-1">
                        <Button asChild variant="ghost" size="sm" className="gap-1">
                          <Link to={`/benchmarks/compare/saved/${item.id}`}>
                            <ArrowRight className="h-4 w-4" />
                            <span>{tCommon("actions.detail")}</span>
                          </Link>
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
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
