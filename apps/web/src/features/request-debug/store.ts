import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DebugResponse, HttpMethod, KeyValueRow } from "./types";

interface DebugState {
  selectedConnectionId: string | null;
  curlInput: string;
  method: HttpMethod;
  url: string;
  headers: KeyValueRow[];
  query: KeyValueRow[];
  body: string;
  /** Last successful response. Transient — not persisted. */
  lastResponse: DebugResponse | null;
  /** Last error message. Transient — not persisted. */
  lastError: string | null;
  setSelected: (id: string | null) => void;
  patch: <K extends keyof DebugState>(key: K, value: DebugState[K]) => void;
  setLastResponse: (r: DebugResponse | null) => void;
  setLastError: (e: string | null) => void;
  /** Clear runtime output only (response + error). Preserves form config. */
  resetResults: () => void;
  /** Full reset to factory defaults. */
  reset: () => void;
}

const INITIAL = {
  selectedConnectionId: null as string | null,
  curlInput: "",
  method: "POST" as HttpMethod,
  url: "",
  headers: [{ key: "Content-Type", value: "application/json", enabled: true }] as KeyValueRow[],
  query: [] as KeyValueRow[],
  body: "",
  lastResponse: null as DebugResponse | null,
  lastError: null as string | null,
};

export const useDebugStore = create<DebugState>()(
  persist(
    (set) => ({
      ...INITIAL,
      setSelected: (id) => set({ selectedConnectionId: id }),
      patch: (key, value) => set({ [key]: value } as Partial<DebugState>),
      setLastResponse: (r) => set({ lastResponse: r, lastError: null }),
      setLastError: (e) => set({ lastError: e, lastResponse: null }),
      resetResults: () => set({ lastResponse: null, lastError: null }),
      reset: () => set(INITIAL),
    }),
    {
      name: "md.debug.v1",
      partialize: (s) => ({
        selectedConnectionId: s.selectedConnectionId,
        curlInput: s.curlInput,
        method: s.method,
        url: s.url,
        headers: s.headers,
        query: s.query,
        body: s.body,
        // lastResponse / lastError are transient — not persisted
      }),
    },
  ),
);
