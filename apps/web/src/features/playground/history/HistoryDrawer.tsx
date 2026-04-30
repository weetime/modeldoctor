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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { History, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import type { StoreApi, UseBoundStore } from "zustand";
import type { HistoryEntry, HistoryStoreState } from "./createHistoryStore";

export interface HistoryDrawerProps<S> {
  useHistoryStore: UseBoundStore<StoreApi<HistoryStoreState<S>>>;
  /** Optional slot for extra controls per history row (e.g. a play button for audio). */
  renderRowExtras?: (entry: HistoryEntry<S>) => ReactNode;
  /**
   * Called just AFTER restore() is confirmed, with the source entry (the one being
   * restored FROM). Lets callers read blobs or perform side-effects tied to that entry.
   */
  onRestoreConfirm?: (sourceEntry: HistoryEntry<S>) => void;
}

export function HistoryDrawer<S>({
  useHistoryStore,
  renderRowExtras,
  onRestoreConfirm,
}: HistoryDrawerProps<S>) {
  const { t } = useTranslation("playground");
  const list = useHistoryStore((s) => s.list);
  const currentId = useHistoryStore((s) => s.currentId);
  const newSession = useHistoryStore((s) => s.newSession);
  const restore = useHistoryStore((s) => s.restore);
  const removeEntry = useHistoryStore((s) => s.removeEntry);
  const olders = list.filter((e) => e.id !== currentId);

  // Pending restore target — when set, the AlertDialog is open. Confirm calls
  // restore(); cancel just clears the target.
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={t("history.title")}>
            <History className="mr-1 h-4 w-4" />
            {t("history.title")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              newSession();
            }}
          >
            {t("history.newSession")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {t("history.title")}
          </DropdownMenuLabel>
          {olders.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("history.empty")}</div>
          ) : (
            olders.map((e) => (
              <DropdownMenuItem
                key={e.id}
                onSelect={(ev) => {
                  ev.preventDefault();
                  setPendingRestoreId(e.id);
                }}
                className="flex items-start justify-between gap-2"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="line-clamp-1 text-xs">{e.preview || t("history.untitled")}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                </div>
                {renderRowExtras?.(e)}
                <button
                  type="button"
                  aria-label={t("history.delete")}
                  className="shrink-0 rounded-sm p-1 text-muted-foreground opacity-60 hover:bg-destructive/10 hover:text-destructive hover:opacity-100"
                  onClick={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    removeEntry(e.id);
                  }}
                  // Radix DropdownMenuItem decides whether to fire onSelect on
                  // pointer-up by inspecting whether pointer-down's default was
                  // prevented. Both preventDefault and stopPropagation are
                  // required: the former blocks the select-trigger, the latter
                  // keeps the menuitem from re-receiving the event.
                  onPointerDown={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                  }}
                  onPointerUp={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={pendingRestoreId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRestoreId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("history.restoreTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("history.restoreConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("history.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRestoreId) {
                  restore(pendingRestoreId);
                  if (onRestoreConfirm) {
                    const sourceEntry = list.find((e) => e.id === pendingRestoreId);
                    if (sourceEntry) onRestoreConfirm(sourceEntry);
                  }
                }
                setPendingRestoreId(null);
              }}
            >
              {t("history.restoreAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
