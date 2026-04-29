import { create } from "zustand";

export interface RerankParams {
  wire: "cohere" | "tei";
  topN: number;
  returnDocuments: boolean;
}

export interface RerankHit {
  index: number;
  score: number;
}

export interface RerankStoreState {
  selectedConnectionId: string | null;
  query: string;
  documents: string[];
  batchMode: boolean;
  params: RerankParams;
  loading: boolean;
  results: RerankHit[];
  error: string | null;
  setSelected: (id: string | null) => void;
  setQuery: (s: string) => void;
  addDocument: () => void;
  removeDocument: (i: number) => void;
  setDocAt: (i: number, text: string) => void;
  setBatchMode: (b: boolean) => void;
  setBatchText: (s: string) => void;
  patchParams: (p: Partial<RerankParams>) => void;
  setLoading: (b: boolean) => void;
  setResults: (r: RerankHit[]) => void;
  setError: (s: string | null) => void;
  reset: () => void;
}

const initial = {
  selectedConnectionId: null,
  query: "",
  documents: [""],
  batchMode: false,
  params: { wire: "cohere" as const, topN: 3, returnDocuments: false },
  loading: false,
  results: [] as RerankHit[],
  error: null as string | null,
};

export const useRerankStore = create<RerankStoreState>((set) => ({
  ...initial,
  setSelected: (id) => set({ selectedConnectionId: id }),
  setQuery: (s) => set({ query: s }),
  addDocument: () => set((s) => ({ documents: [...s.documents, ""] })),
  removeDocument: (i) =>
    set((s) => {
      const next = s.documents.filter((_, idx) => idx !== i);
      return { documents: next.length > 0 ? next : [""] };
    }),
  setDocAt: (i, text) =>
    set((s) => {
      const next = s.documents.slice();
      next[i] = text;
      return { documents: next };
    }),
  setBatchMode: (b) => set({ batchMode: b }),
  setBatchText: (s) =>
    set({
      documents: s
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    }),
  patchParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
  setLoading: (b) => set({ loading: b }),
  setResults: (r) => set({ results: [...r].sort((a, b) => b.score - a.score) }),
  setError: (e) => set({ error: e }),
  reset: () => set({ ...initial, documents: [""], results: [] }),
}));
