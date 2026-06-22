import type { LlmJudgeProviderPublic } from "@modeldoctor/contracts";
import { Bot, MoreHorizontal, Pencil, Power, Star, Trash2 } from "lucide-react";
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
import { useAuthStore } from "@/stores/auth-store";
import { toastLlmJudgeError } from "./errors";
import { ProviderSheet, type ProviderSheetMode } from "./ProviderSheet";
import {
  useDeleteLlmJudgeProvider,
  useLlmJudgeProviders,
  useSetDefaultLlmJudgeProvider,
  useUpdateLlmJudgeProvider,
} from "./queries";

export function LlmJudgeProvidersPage() {
  const { t } = useTranslation("llm-judge-providers");
  const { t: tc } = useTranslation("common");
  const { t: tSidebar } = useTranslation("sidebar");

  const listQuery = useLlmJudgeProviders();
  const deleteMut = useDeleteLlmJudgeProvider();
  const setDefaultMut = useSetDefaultLlmJudgeProvider();
  const updateMut = useUpdateLlmJudgeProvider();

  const user = useAuthStore((s) => s.user);
  const isAdmin = (user?.roles ?? []).includes("admin");

  const [dialogMode, setDialogMode] = useState<ProviderSheetMode | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LlmJudgeProviderPublic | null>(null);

  const list: LlmJudgeProviderPublic[] = listQuery.data ?? [];
  const isLoading = listQuery.isLoading;
  const error = listQuery.error;

  const onConfirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMut.mutateAsync(pendingDelete.id);
      toast.success(t("toast.deleteSuccess"));
    } catch (e) {
      toastLlmJudgeError(t, e);
    } finally {
      setPendingDelete(null);
    }
  };

  const onSetDefault = async (p: LlmJudgeProviderPublic) => {
    try {
      await setDefaultMut.mutateAsync(p.id);
      toast.success(t("toast.setDefaultSuccess"));
    } catch (e) {
      toastLlmJudgeError(t, e);
    }
  };

  const onToggleEnabled = async (p: LlmJudgeProviderPublic) => {
    try {
      await updateMut.mutateAsync({ id: p.id, body: { enabled: !p.enabled } });
      toast.success(p.enabled ? t("toast.disabledSuccess") : t("toast.enabledSuccess"));
    } catch (e) {
      toastLlmJudgeError(t, e);
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
            <Button size="sm" onClick={() => setDialogMode({ kind: "create" })}>
              {t("page.actions.new")}
            </Button>
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
            icon={Bot}
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
                  <TableHead>{t("table.columns.model")}</TableHead>
                  <TableHead>{t("table.columns.status")}</TableHead>
                  <TableHead>{t("table.columns.isDefault")}</TableHead>
                  <TableHead className="w-24 text-center">{t("table.columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      {isAdmin ? (
                        <button
                          type="button"
                          className="text-left hover:text-primary hover:underline"
                          onClick={() => setDialogMode({ kind: "edit", existing: p })}
                        >
                          {p.name}
                        </button>
                      ) : (
                        <span>{p.name}</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.baseUrl}</TableCell>
                    <TableCell className="font-mono text-xs">{p.model}</TableCell>
                    <TableCell>
                      {p.enabled ? (
                        <Badge variant="outline" className="text-xs">
                          {t("table.statusEnabled")}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-muted-foreground/30 text-xs text-muted-foreground"
                        >
                          {t("table.statusDisabled")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {p.isDefault ? (
                        <Badge variant="default" className="text-xs">
                          {t("table.defaultBadge")}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="inline-flex items-center gap-1">
                        {isAdmin ? (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={tc("actions.edit")}
                              title={tc("actions.edit")}
                              onClick={() => setDialogMode({ kind: "edit", existing: p })}
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
                                {!p.isDefault ? (
                                  <DropdownMenuItem
                                    onClick={() => onSetDefault(p)}
                                    className="gap-2"
                                  >
                                    <Star className="h-4 w-4" />
                                    {t("actions.setDefault")}
                                  </DropdownMenuItem>
                                ) : null}
                                {/* The default must stay enabled, so only offer the
                                    toggle for non-default rows. */}
                                {!p.isDefault ? (
                                  <DropdownMenuItem
                                    onClick={() => onToggleEnabled(p)}
                                    className="gap-2"
                                  >
                                    <Power className="h-4 w-4" />
                                    {p.enabled ? t("actions.disable") : t("actions.enable")}
                                  </DropdownMenuItem>
                                ) : null}
                                <DropdownMenuItem
                                  onClick={() => setPendingDelete(p)}
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
        <ProviderSheet
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
        title={t("delete.title", { name: pendingDelete?.name ?? "" })}
        description={t("delete.body")}
        confirmLabel={t("delete.confirm")}
        pending={deleteMut.isPending}
        onConfirm={onConfirmDelete}
      />
    </>
  );
}
