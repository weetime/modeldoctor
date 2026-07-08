import type { McpServerPublic } from "@modeldoctor/contracts";
import { MoreHorizontal, Pencil, Plug, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/common/confirm-delete-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
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
import { McpServerSheet, type McpServerSheetMode } from "./McpServerSheet";
import { useDeleteMcpServer, useMcpServers } from "./queries";

export function McpServersPage() {
  const { t } = useTranslation("mcp-servers");
  const { t: tc } = useTranslation("common");
  const listQuery = useMcpServers();
  const deleteMut = useDeleteMcpServer();
  const list: McpServerPublic[] = listQuery.data ?? [];

  const [dialogMode, setDialogMode] = useState<McpServerSheetMode | null>(null);
  const [pendingDelete, setPendingDelete] = useState<McpServerPublic | null>(null);

  const isLoading = listQuery.isLoading;
  const error = listQuery.error;

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        rightSlot={
          <Button size="sm" onClick={() => setDialogMode({ kind: "create" })}>
            {t("actions.new")}
          </Button>
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
            icon={Plug}
            title={t("empty.title")}
            body={t("empty.body")}
            actions={
              <Button size="sm" onClick={() => setDialogMode({ kind: "create" })}>
                {t("empty.create")}
              </Button>
            }
          />
        ) : (
          <div className="rounded-md border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("table.name")}</TableHead>
                  <TableHead>{t("table.url")}</TableHead>
                  <TableHead>{t("table.transport")}</TableHead>
                  <TableHead>{t("table.status")}</TableHead>
                  <TableHead className="w-24 text-center">{t("table.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className={`font-medium ${s.enabled ? "" : "opacity-50"}`}>
                      <button
                        type="button"
                        className="text-left hover:text-primary hover:underline"
                        onClick={() => setDialogMode({ kind: "edit", existing: s })}
                      >
                        {s.name}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{s.url}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs uppercase">
                        {s.transport}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {s.enabled ? (
                        <Badge variant="outline" className="text-xs">
                          {t("badges.enabled")}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          {t("badges.disabled")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("actions.edit")}
                          title={t("actions.edit")}
                          onClick={() => setDialogMode({ kind: "edit", existing: s })}
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
                              onClick={() => setPendingDelete(s)}
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
        )}
      </div>

      {dialogMode ? (
        <McpServerSheet
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
              onError: () => toast.error(t("delete.error")),
            });
          }
          setPendingDelete(null);
        }}
      />
    </>
  );
}
