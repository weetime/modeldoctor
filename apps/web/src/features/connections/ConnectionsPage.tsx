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
import { useConnectionsStore } from "@/stores/connections-store";
import type { Connection } from "@/types/connection";
import type { ModalityCategory } from "@modeldoctor/contracts";
import { format } from "date-fns";
import { Database, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConnectionDialog } from "./ConnectionDialog";
import { ConnectionsImportDialog } from "./ConnectionsImportDialog";

export function ConnectionsPage() {
  const { t } = useTranslation("connections");
  const { t: tc } = useTranslation("common");
  const list = useConnectionsStore((s) => s.list());
  const removeConn = useConnectionsStore((s) => s.remove);
  const exportAll = useConnectionsStore((s) => s.exportAll);

  const [filterCategory, setFilterCategory] = useState<ModalityCategory | "all">("all");
  const [filterTag, setFilterTag] = useState<string | "all">("all");

  const allTags = Array.from(new Set(list.flatMap((c) => c.tags))).sort();

  const filtered = list.filter((c) => {
    if (filterCategory !== "all" && c.category !== filterCategory) return false;
    if (filterTag !== "all" && !c.tags.includes(filterTag)) return false;
    return true;
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Connection | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Connection | null>(null);

  const onExport = () => {
    const blob = new Blob([exportAll()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `modeldoctor-connections-${format(new Date(), "yyyy-MM-dd")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        rightSlot={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              {t("actions.import")}
            </Button>
            <Button variant="outline" size="sm" onClick={onExport} disabled={list.length === 0}>
              {t("actions.export")}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setEditing(undefined);
                setDialogOpen(true);
              }}
            >
              {t("actions.new")}
            </Button>
          </div>
        }
      />

      <div className="px-8 py-6">
        {list.length === 0 ? (
          <EmptyState
            icon={Database}
            title={t("empty.title")}
            body={t("empty.body")}
            actions={
              <Button
                size="sm"
                onClick={() => {
                  setEditing(undefined);
                  setDialogOpen(true);
                }}
              >
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
                      <TableCell className="font-mono text-xs">{c.apiBaseUrl}</TableCell>
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
                          onClick={() => {
                            setEditing(c);
                            setDialogOpen(true);
                          }}
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

      <ConnectionDialog open={dialogOpen} onOpenChange={setDialogOpen} connection={editing} />
      <ConnectionsImportDialog open={importOpen} onOpenChange={setImportOpen} />

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
                if (pendingDelete) removeConn(pendingDelete.id);
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
