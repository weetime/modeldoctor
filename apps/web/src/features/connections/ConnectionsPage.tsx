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
import type { ConnectionPublic, ModalityCategory } from "@modeldoctor/contracts";
import { format } from "date-fns";
import { Database, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConnectionDialog, type ConnectionDialogMode } from "./ConnectionDialog";
import { useConnections, useDeleteConnection } from "./queries";

export function ConnectionsPage() {
  const { t } = useTranslation("connections");
  const { t: tc } = useTranslation("common");
  const listQuery = useConnections();
  const deleteMut = useDeleteConnection();
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

  const [dialogMode, setDialogMode] = useState<ConnectionDialogMode | null>(null);
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
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
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
            <div className="rounded-lg border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("table.name")}</TableHead>
                    <TableHead>{t("table.apiBaseUrl")}</TableHead>
                    <TableHead>{t("table.apiKey")}</TableHead>
                    <TableHead>{t("table.model")}</TableHead>
                    <TableHead>{t("table.category")}</TableHead>
                    <TableHead>{t("table.tags")}</TableHead>
                    <TableHead>{t("table.customHeaders")}</TableHead>
                    <TableHead>{t("table.createdAt")}</TableHead>
                    <TableHead className="w-[120px] text-right">{t("table.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="font-mono text-xs">{c.baseUrl}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {c.apiKeyPreview}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{c.model}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {t(`dialog.categoryOptions.${c.category}`)}
                        </Badge>
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
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(c.createdAt), "yyyy-MM-dd HH:mm")}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("actions.edit")}
                          onClick={() => setDialogMode({ kind: "edit", existing: c })}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("actions.delete")}
                          onClick={() => setPendingDelete(c)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
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
        <ConnectionDialog
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
            <AlertDialogTitle>{t("delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("delete.body", { name: pendingDelete?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) {
                  deleteMut.mutate(pendingDelete.id);
                }
                setPendingDelete(null);
              }}
            >
              {t("delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
