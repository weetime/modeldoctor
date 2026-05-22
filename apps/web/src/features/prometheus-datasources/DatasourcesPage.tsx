import type { PrometheusDatasourcePublic } from "@modeldoctor/contracts";
import { Database, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
import { useAuthStore } from "@/stores/auth-store";
import { DatasourceSheet, type DatasourceSheetMode } from "./DatasourceSheet";
import { toastDatasourceError } from "./errors";
import { useDatasources, useDeleteDatasource } from "./queries";

export function DatasourcesPage() {
  const { t } = useTranslation("prometheus-datasources");
  const { t: tc } = useTranslation("common");
  const { t: tSidebar } = useTranslation("sidebar");

  const listQuery = useDatasources();
  const deleteMut = useDeleteDatasource();

  const user = useAuthStore((s) => s.user);
  const isAdmin = (user?.roles ?? []).includes("admin");

  const [dialogMode, setDialogMode] = useState<DatasourceSheetMode | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PrometheusDatasourcePublic | null>(null);

  const list: PrometheusDatasourcePublic[] = listQuery.data ?? [];
  const isLoading = listQuery.isLoading;
  const error = listQuery.error;

  const onConfirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      const res = await deleteMut.mutateAsync(pendingDelete.id);
      toast.success(t("toast.deleteSuccess", { count: res.consumersDetached }));
    } catch (e) {
      toastDatasourceError(t, e);
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <>
      <PageHeader
        title={t("page.title")}
        subtitle={t("page.subtitle")}
        breadcrumbs={[
          { label: tSidebar("items.settings"), to: "/settings" },
          { label: t("page.breadcrumb") },
        ]}
        rightSlot={
          isAdmin ? (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setDialogMode({ kind: "create" })}>
                {t("page.actions.new")}
              </Button>
            </div>
          ) : null
        }
      />

      <div className="px-8 py-6">
        {isLoading ? (
          <div
            role="status"
            aria-label="loading"
            className="h-64 animate-pulse rounded-md border border-border bg-muted/30"
          />
        ) : error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error instanceof Error ? error.message : tc("errors.unknown")}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={Database}
            title={t("page.empty.title")}
            body={t("page.empty.subtitle")}
            actions={
              isAdmin ? (
                <Button size="sm" onClick={() => setDialogMode({ kind: "create" })}>
                  {t("page.actions.new")}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="rounded-md border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("table.columns.name")}</TableHead>
                  <TableHead>{t("table.columns.baseUrl")}</TableHead>
                  <TableHead>{t("table.columns.auth")}</TableHead>
                  <TableHead>{t("table.columns.isDefault")}</TableHead>
                  <TableHead>{t("table.columns.consumers")}</TableHead>
                  <TableHead className="w-24 text-center">{t("table.columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((ds) => (
                  <TableRow key={ds.id}>
                    <TableCell className="font-medium">
                      {isAdmin ? (
                        <button
                          type="button"
                          className="text-left hover:text-primary hover:underline"
                          onClick={() => setDialogMode({ kind: "edit", existing: ds })}
                        >
                          {ds.name}
                        </button>
                      ) : (
                        <span>{ds.name}</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{ds.baseUrl}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {ds.bearerPreview && ds.bearerPreview.length > 0
                          ? t("table.authBearer")
                          : t("table.authAnonymous")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {ds.isDefault ? (
                        <Badge variant="default" className="text-xs">
                          {t("table.defaultBadge")}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{ds.consumersCount}</TableCell>
                    <TableCell className="text-center">
                      <div className="inline-flex items-center gap-1">
                        {isAdmin ? (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={tc("actions.edit")}
                              title={tc("actions.edit")}
                              onClick={() => setDialogMode({ kind: "edit", existing: ds })}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={tc("table.actions")}
                                  title={tc("table.actions")}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => setPendingDelete(ds)}
                                  className="gap-2 text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  {tc("actions.delete")}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
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

      {dialogMode ? (
        <DatasourceSheet
          open
          onOpenChange={(o) => {
            if (!o) setDialogMode(null);
          }}
          mode={dialogMode}
        />
      ) : null}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("delete.title", { name: pendingDelete?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("delete.body", { count: pendingDelete?.consumersCount ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDelete}>{t("delete.confirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
