import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { History } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { StoreApi, UseBoundStore } from "zustand";
import type { HistoryStoreState } from "./createHistoryStore";

export interface HistoryDrawerProps<S> {
  useHistoryStore: UseBoundStore<StoreApi<HistoryStoreState<S>>>;
}

export function HistoryDrawer<S>({ useHistoryStore }: HistoryDrawerProps<S>) {
  const { t } = useTranslation("playground");
  const list = useHistoryStore((s) => s.list);
  const currentId = useHistoryStore((s) => s.currentId);
  const newSession = useHistoryStore((s) => s.newSession);
  const restore = useHistoryStore((s) => s.restore);
  const olders = list.filter((e) => e.id !== currentId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t("history.title")}>
          <History className="mr-1 h-4 w-4" />
          {t("history.title")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
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
                if (window.confirm(t("history.restoreConfirm"))) {
                  restore(e.id);
                }
              }}
              className="flex flex-col items-start gap-0.5"
            >
              <span className="line-clamp-1 text-xs">{e.preview || t("history.untitled")}</span>
              <span className="text-[10px] text-muted-foreground">
                {new Date(e.createdAt).toLocaleString()}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
