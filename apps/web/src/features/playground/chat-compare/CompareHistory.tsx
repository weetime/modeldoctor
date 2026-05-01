/**
 * CompareHistory — IDB-backed snapshot save/restore for ChatComparePage.
 *
 * Exports:
 *   - `useCompareHistoryStore`  zustand store created via `createHistoryStore`
 *   - `CompareHistoryControls`  "Save snapshot" button + history dropdown
 */

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { History, Save, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { createHistoryStore } from "../history/createHistoryStore";
import {
  applyBlobPatches,
  persistMessageAttachments,
  rehydrateMessageBlobs,
} from "../history/persistAttachments";
import { type CompareSnapshot, useCompareStore } from "./store";

// ---------------------------------------------------------------------------
// History store
// ---------------------------------------------------------------------------

export const useCompareHistoryStore = createHistoryStore<CompareSnapshot>({
  name: "md-playground-history-compare",
  blank: () => ({
    panelCount: 2,
    systemMessage: "",
    panels: [
      { connectionId: null, params: {}, messages: [] },
      { connectionId: null, params: {}, messages: [] },
    ],
  }),
  preview: (s) => {
    const firstMsg = s.panels.flatMap((p) => p.messages).find((m) => m.role === "user");
    const text =
      firstMsg == null
        ? ""
        : typeof firstMsg.content === "string"
          ? firstMsg.content.slice(0, 40)
          : "[multimodal]";
    return `${s.panelCount} panels · ${text}`;
  },
  maxEntries: 20,
});

// ---------------------------------------------------------------------------
// Save helper
// ---------------------------------------------------------------------------

/**
 * Capture the current compare working state, persist blob attachments to IDB,
 * and save the sanitised snapshot as a new history entry.
 */
export async function saveCompareSnapshot(): Promise<void> {
  const state = useCompareStore.getState();
  const histStore = useCompareHistoryStore.getState();

  // Build the raw snapshot from current working state.
  const snap: CompareSnapshot = {
    panelCount: state.panelCount,
    systemMessage: state.sharedSystemMessage,
    panels: state.panels.slice(0, state.panelCount).map((p) => ({
      connectionId: p.selectedConnectionId,
      params: p.params,
      messages: p.messages,
    })),
  };

  // Create a fresh history entry so each Save is its own entry.
  histStore.newSession();
  const entryId = useCompareHistoryStore.getState().currentId;

  // Persist blobs panel-by-panel with a panel-indexed key prefix.
  const sanitisedPanels = await Promise.all(
    snap.panels.map((panel, p) =>
      persistMessageAttachments(entryId, panel.messages, histStore, `panel${p}.`).then((msgs) => ({
        ...panel,
        messages: msgs,
      })),
    ),
  );

  const sanitised: CompareSnapshot = { ...snap, panels: sanitisedPanels };
  histStore.save(sanitised);
}

// ---------------------------------------------------------------------------
// Restore helper
// ---------------------------------------------------------------------------

/**
 * Restore a saved snapshot by ID: rehydrate IDB blobs then swap the compare
 * working state.
 */
export async function restoreCompareSnapshot(entryId: string): Promise<void> {
  const histStore = useCompareHistoryStore.getState();
  const entry = histStore.list.find((e) => e.id === entryId);
  if (!entry) return;

  const snap = entry.snapshot;

  // Rehydrate blobs for each panel.
  const rehydratedPanels = await Promise.all(
    snap.panels.map(async (panel, p) => {
      const patches = await rehydrateMessageBlobs(entryId, panel.messages, histStore, `panel${p}.`);
      const msgs = applyBlobPatches(panel.messages, patches);
      return { ...panel, messages: msgs };
    }),
  );

  const rehydrated: CompareSnapshot = { ...snap, panels: rehydratedPanels };
  useCompareStore.getState().restoreSnapshot(rehydrated);
}

// ---------------------------------------------------------------------------
// UI component
// ---------------------------------------------------------------------------

export function CompareHistoryControls() {
  const { t } = useTranslation("playground");
  const list = useCompareHistoryStore((s) => s.list);
  const currentId = useCompareHistoryStore((s) => s.currentId);
  const removeEntry = useCompareHistoryStore((s) => s.removeEntry);

  // Snapshots that are NOT the current session (those are proper saves).
  const snapshots = list.filter(
    (e) => e.id !== currentId && e.snapshot.panels.some((p) => p.messages.length > 0),
  );

  const handleSave = () => {
    saveCompareSnapshot()
      .then(() => toast.success(t("chatCompare.history.snapshotSaved")))
      .catch((e) => {
        console.error("[CompareHistory] save failed", e);
        toast.error(t("chatCompare.history.saveFailed"));
      });
  };

  const handleRestore = (id: string) => {
    restoreCompareSnapshot(id)
      .then(() => toast.success(t("chatCompare.history.restored")))
      .catch((e) => {
        console.error("[CompareHistory] restore failed", e);
        toast.error(t("chatCompare.history.restoreFailed"));
      });
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={handleSave}
        aria-label={t("chatCompare.history.saveSnapshot")}
      >
        <Save className="mr-1 h-3.5 w-3.5" />
        {t("chatCompare.history.saveSnapshot")}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={t("chatCompare.history.title")}>
            <History className="mr-1 h-4 w-4" />
            {t("chatCompare.history.title")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {t("chatCompare.history.title")}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {snapshots.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("chatCompare.history.empty")}
            </div>
          ) : (
            snapshots.map((e) => (
              <DropdownMenuItem
                key={e.id}
                onSelect={(ev) => {
                  ev.preventDefault();
                  handleRestore(e.id);
                }}
                className="flex items-start justify-between gap-2"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="line-clamp-1 text-xs">
                    {e.preview || t("chatCompare.history.untitled")}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label={t("chatCompare.history.delete")}
                  className="shrink-0 rounded-sm p-1 text-muted-foreground opacity-60 hover:bg-destructive/10 hover:text-destructive hover:opacity-100"
                  onClick={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    removeEntry(e.id);
                  }}
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
    </div>
  );
}
