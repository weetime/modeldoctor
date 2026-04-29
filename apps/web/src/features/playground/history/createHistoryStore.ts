import { type StoreApi, type UseBoundStore, create } from "zustand";
import { persist } from "zustand/middleware";

export interface HistoryEntry<S> {
  id: string;
  createdAt: string;
  preview: string;
  snapshot: S;
}

export interface HistoryStoreState<S> {
  list: HistoryEntry<S>[];
  currentId: string;
  /**
   * Bumped each time newSession or restore replaces the active snapshot.
   * Pages combine this with currentId in their restore-effect dep list so a
   * restore (which keeps currentId stable) still re-fires the effect, while
   * routine save/scheduleAutoSave (which leaves the version alone) does not.
   */
  restoreVersion: number;
  save: (snapshot: S) => void;
  scheduleAutoSave: (snapshot: S) => void;
  newSession: () => void;
  restore: (id: string) => void;
  /** Remove a single non-current entry. No-op for the current entry. */
  removeEntry: (id: string) => void;
  reset: () => void;
}

export interface CreateHistoryStoreInput<S> {
  /** localStorage key — must be unique per modality. */
  name: string;
  /** Returns a fresh blank snapshot for new sessions. */
  blank: () => S;
  /** Returns a one-line summary for the drawer UI. */
  preview: (s: S) => string;
  /** Defaults to 20. */
  maxEntries?: number;
  /** Defaults to 1500ms. */
  debounceMs?: number;
}

function newId(): string {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `h_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

export function createHistoryStore<S>(
  input: CreateHistoryStoreInput<S>,
): UseBoundStore<StoreApi<HistoryStoreState<S>>> {
  const max = input.maxEntries ?? 20;
  const debounce = input.debounceMs ?? 1500;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const seed = (): { list: HistoryEntry<S>[]; currentId: string; restoreVersion: number } => {
    const id = newId();
    return {
      list: [{ id, createdAt: new Date().toISOString(), preview: "", snapshot: input.blank() }],
      currentId: id,
      restoreVersion: 0,
    };
  };

  return create<HistoryStoreState<S>>()(
    persist(
      (set, get) => ({
        ...seed(),
        save: (snapshot) =>
          set((s) => {
            const next = s.list.slice();
            const idx = next.findIndex((e) => e.id === s.currentId);
            if (idx === -1) return s;
            next[idx] = {
              ...next[idx],
              snapshot,
              preview: input.preview(snapshot),
            };
            return { list: next };
          }),
        scheduleAutoSave: (snapshot) => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            get().save(snapshot);
            timer = null;
          }, debounce);
        },
        newSession: () =>
          set((s) => {
            const id = newId();
            const fresh: HistoryEntry<S> = {
              id,
              createdAt: new Date().toISOString(),
              preview: "",
              snapshot: input.blank(),
            };
            const trimmed = [fresh, ...s.list].slice(0, max);
            return { list: trimmed, currentId: id, restoreVersion: s.restoreVersion + 1 };
          }),
        restore: (id) =>
          set((s) => {
            const entry = s.list.find((e) => e.id === id);
            if (!entry || id === s.currentId) return s;
            const next = s.list.slice();
            const curIdx = next.findIndex((e) => e.id === s.currentId);
            if (curIdx === -1) return s;
            next[curIdx] = {
              ...next[curIdx],
              snapshot: entry.snapshot,
              preview: entry.preview,
            };
            return { list: next, restoreVersion: s.restoreVersion + 1 };
          }),
        removeEntry: (id) =>
          set((s) => {
            // Never remove the current entry — UI must guard against this too.
            if (id === s.currentId) return s;
            return { list: s.list.filter((e) => e.id !== id) };
          }),
        reset: () => set(seed()),
      }),
      {
        name: input.name,
        version: 1,
      },
    ),
  );
}
