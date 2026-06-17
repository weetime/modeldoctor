import type {
  ConnectionPublic,
  ConnectionStatusFilter,
  ModalityCategory,
} from "@modeldoctor/contracts";
import { Activity, Database, MoreHorizontal, Pencil, Power, PowerOff, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/common/confirm-delete-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { RelativeTime } from "@/components/common/relative-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConnectionSheet, type ConnectionSheetMode } from "./ConnectionSheet";
import {
  useConnections,
  useDeleteConnection,
  useSetConnectionEnabled,
  useTestConnection,
} from "./queries";

export function ConnectionsPage() {
  const { t } = useTranslation("connections");
  const { t: tc } = useTranslation("common");
  const [filterStatus, setFilterStatus] = useState<ConnectionStatusFilter>("enabled");
  const listQuery = useConnections({ status: filterStatus });
  const deleteMut = useDeleteConnection();
  const setEnabled = useSetConnectionEnabled();
  const testConn = useTestConnection();
  const list: ConnectionPublic[] = listQuery.data ?? [];

  const [filterCategory, setFilterCategory] = useState<ModalityCategory | "all">("all");
  const [filterTag, setFilterTag] = useState<string | "all">("all");

  const allTags = Array.from(new Set(list.flatMap((c) => c.tags))).sort();

  useEffect(() => {
    if (filterTag !== "all" && !allTags.includes(filterTag)) {
      setFilterTag("all");
    }
  }, [allTags, filterTag]);

  const filtered = list.filter((c) => {
    if (filterCategory !== "all" && c.category !== filterCategory) return false;
    if (filterTag !== "all" && !c.tags.includes(filterTag)) return false;
    return true;
  });

  const [dialogMode, setDialogMode] = useState<ConnectionSheetMode | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ConnectionPublic | null>(null);

  const isLoading = listQuery.isLoading;
  const error = listQuery.error;

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        rightSlot={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setDialogMode({ kind: "create" })}>
              {t("actions.new")}
            </Button>
          </div>
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
            title={t("empty.title")}
            body={t("empty.body")}
            actions={
              <Button size="sm" onClick={() => setDialogMode({ kind: "create" })}>
                {t("empty.create")}
              </Button>
            }
          />
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("filters.label")}:</span>
              <Select
                value={filterStatus}
                onValueChange={(v) => setFilterStatus(v as ConnectionStatusFilter)}
              >
                <SelectTrigger className="h-8 w-32 text-xs" aria-label={t("filters.status")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="enabled">{t("filters.statusEnabled")}</SelectItem>
                  <SelectItem value="disabled">{t("filters.statusDisabled")}</SelectItem>
                  <SelectItem value="all">{t("filters.statusAll")}</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={filterCategory}
                onValueChange={(v) => setFilterCategory(v as ModalityCategory | "all")}
              >
                <SelectTrigger
                  className="h-8 w-40 text-xs"
                  aria-label={t("dialog.fields.category")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filters.allCategories")}</SelectItem>
                  {(["chat", "audio", "embeddings", "rerank", "image"] as ModalityCategory[]).map(
                    (c) => (
                      <SelectItem key={c} value={c}>
                        {t(`dialog.categoryOptions.${c}`)}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              <Select value={filterTag} onValueChange={setFilterTag}>
                <SelectTrigger className="h-8 w-40 text-xs" aria-label={t("dialog.fields.tags")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filters.allTags")}</SelectItem>
                  {allTags.map((tag) => (
                    <SelectItem key={tag} value={tag}>
                      {tag}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("table.name")}</TableHead>
                    <TableHead>{t("table.model")}</TableHead>
                    <TableHead>{t("table.apiBaseUrl")}</TableHead>
                    <TableHead>{t("table.apiKey")}</TableHead>
                    <TableHead>{t("table.category")}</TableHead>
                    <TableHead>{t("table.columns.prometheusDatasource")}</TableHead>
                    <TableHead>{t("table.tags")}</TableHead>
                    <TableHead>{t("table.customHeaders")}</TableHead>
                    <TableHead>{t("table.createdAt")}</TableHead>
                    <TableHead className="w-24 text-center">{t("table.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className={`font-medium ${c.enabled ? "" : "opacity-50"}`}>
                        <button
                          type="button"
                          className="text-left hover:text-primary hover:underline"
                          onClick={() => setDialogMode({ kind: "edit", existing: c })}
                        >
                          {c.name}
                        </button>
                        {!c.enabled && (
                          <Badge variant="outline" className="ml-2 text-xs text-muted-foreground">
                            {t("badges.disabled")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{c.model || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{c.baseUrl}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {c.apiKeyPreview || "—"}
                      </TableCell>
                      <TableCell>
                        {c.category ? (
                          <Badge variant="outline" className="text-xs">
                            {t(`dialog.categoryOptions.${c.category}`)}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {c.prometheusDatasource ? (
                          <Link
                            to="/settings/prometheus-datasources"
                            className="text-xs text-primary hover:underline"
                          >
                            {c.prometheusDatasource.name}
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {c.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-secondary px-2 py-0.5 text-[10px]"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.customHeaders ? `${c.customHeaders.split("\n")[0]}…` : "—"}
                      </TableCell>
                      <TableCell>
                        <RelativeTime date={c.createdAt} />
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("actions.edit")}
                            title={t("actions.edit")}
                            onClick={() => setDialogMode({ kind: "edit", existing: c })}
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
                                className="gap-2"
                                onClick={() =>
                                  testConn.mutate(c.id, {
                                    onSuccess: (h) =>
                                      h.status === "online"
                                        ? toast.success(t("test.online", { ms: h.latencyMs ?? 0 }))
                                        : toast.error(t("test.offline", { reason: h.error ?? "" })),
                                  })
                                }
                              >
                                <Activity className="h-4 w-4" />
                                {t("actions.test")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="gap-2"
                                onClick={() =>
                                  setEnabled.mutate(
                                    { id: c.id, enabled: !c.enabled },
                                    {
                                      onSuccess: () =>
                                        toast.success(
                                          c.enabled ? t("toggle.disabled") : t("toggle.enabled"),
                                        ),
                                      onError: () => toast.error(t("toggle.error")),
                                    },
                                  )
                                }
                              >
                                {c.enabled ? (
                                  <PowerOff className="h-4 w-4" />
                                ) : (
                                  <Power className="h-4 w-4" />
                                )}
                                {c.enabled ? t("actions.disable") : t("actions.enable")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setPendingDelete(c)}
                                className="gap-2 text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                                {t("actions.delete")}
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
          </>
        )}
      </div>

      {dialogMode ? (
        <ConnectionSheet
          open
          onOpenChange={(o) => {
            if (!o) setDialogMode(null);
          }}
          mode={dialogMode}
        />
      ) : null}

      <ConfirmDeleteDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
        title={t("delete.title")}
        description={t("delete.body", { name: pendingDelete?.name })}
        confirmLabel={t("delete.confirm")}
        pending={deleteMut.isPending}
        onConfirm={() => {
          if (pendingDelete) {
            deleteMut.mutate(pendingDelete.id, {
              onSuccess: () => toast.success(t("delete.success")),
              onError: (e) => {
                // 409 = the connection is still referenced by an evaluation run
                // (server blocks the delete to keep the A/B comparison intact).
                const status = (e as { status?: number }).status;
                toast.error(status === 409 ? t("delete.inUse") : t("delete.error"));
              },
            });
          }
          setPendingDelete(null);
        }}
      />
    </>
  );
}
