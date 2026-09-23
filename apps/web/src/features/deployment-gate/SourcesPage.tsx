import type { PlatformSource } from "@modeldoctor/contracts";
import { MoreHorizontal, Pencil, Plus, RefreshCw, Server, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDeleteSource, useSources, useSyncSource } from "./queries";
import { SourceSheet } from "./SourceSheet";

function SourceStatus({ s }: { s: PlatformSource }) {
  const { t } = useTranslation("deployment-gate");
  if (!s.enabled) return <Badge variant="default">{t("sources.status.disabled")}</Badge>;
  if (s.lastSyncError)
    return (
      <Badge variant="destructive" title={s.lastSyncError}>
        {t("sources.status.error")}
      </Badge>
    );
  if (!s.lastSyncAt) return <Badge variant="outline">{t("sources.status.never")}</Badge>;
  return <Badge variant="outline">{t("sources.status.ok")}</Badge>;
}

export function SourcesPage() {
  const { t } = useTranslation("deployment-gate");
  const { t: tCommon } = useTranslation("common");
  const { data, isLoading } = useSources();
  const del = useDeleteSource();
  const sync = useSyncSource();
  const [sheet, setSheet] = useState<{ open: boolean; existing: PlatformSource | null }>({
    open: false,
    existing: null,
  });
  const [pendingDelete, setPendingDelete] = useState<PlatformSource | null>(null);

  async function onSync(id: string) {
    try {
      const r = await sync.mutateAsync(id);
      toast.success(t("sources.synced", { count: r.models }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const addButton = (
    <Button onClick={() => setSheet({ open: true, existing: null })}>
      <Plus className="mr-2 h-4 w-4" />
      {t("sources.add")}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t("sources.title")}
        subtitle={t("sources.subtitle")}
        rightSlot={addButton}
      />
      <div className="px-8 py-6 space-y-6">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">{tCommon("table.loading")}</div>
        ) : !data?.length ? (
          <EmptyState
            icon={Server}
            title={t("sources.empty.title")}
            body={t("sources.empty.body")}
            actions={addButton}
          />
        ) : (
          <div className="rounded-md border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("sources.col.name")}</TableHead>
                  <TableHead>{t("sources.col.baseUrl")}</TableHead>
                  <TableHead className="text-right">{t("sources.col.models")}</TableHead>
                  <TableHead>{t("sources.col.lastSync")}</TableHead>
                  <TableHead>{t("sources.col.status")}</TableHead>
                  <TableHead className="w-32 text-center">{tCommon("table.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        className="text-left hover:text-primary hover:underline"
                        onClick={() => setSheet({ open: true, existing: s })}
                      >
                        {s.name}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{s.baseUrl}</TableCell>
                    <TableCell className="text-right">{s.modelCount}</TableCell>
                    <TableCell>
                      {s.lastSyncAt ? <RelativeTime date={s.lastSyncAt} /> : "—"}
                    </TableCell>
                    <TableCell>
                      <SourceStatus s={s} />
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("sources.sync")}
                          title={t("sources.sync")}
                          onClick={() => onSync(s.id)}
                          disabled={sync.isPending}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={tCommon("actions.edit")}
                          title={tCommon("actions.edit")}
                          onClick={() => setSheet({ open: true, existing: s })}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={tCommon("table.actions")}
                              title={tCommon("table.actions")}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="gap-2 text-destructive focus:text-destructive"
                              onClick={() => setPendingDelete(s)}
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
      <SourceSheet
        open={sheet.open}
        existing={sheet.existing}
        onOpenChange={(open) => setSheet((p) => ({ ...p, open }))}
      />
      <ConfirmDeleteDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={t("sources.delete.title", { name: pendingDelete?.name ?? "" })}
        description={t("sources.deleteConfirm")}
        pending={del.isPending}
        onConfirm={async () => {
          if (pendingDelete) {
            try {
              await del.mutateAsync(pendingDelete.id);
            } catch (e) {
              toast.error((e as Error).message);
            }
          }
          setPendingDelete(null);
        }}
      />
    </>
  );
}
