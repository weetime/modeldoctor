import { create } from "zustand";

export interface EmbeddingsParams {
  encodingFormat?: "float" | "base64";
  dimensions?: number;
}

export interface EmbeddingsStoreState {
  selectedConnectionId: string | null;
  inputs: string[];
  batchMode: boolean;
  params: EmbeddingsParams;
  loading: boolean;
  result: number[][] | null;
  error: string | null;
  setSelected: (id: string | null) => void;
  setInputAt: (idx: number, text: string) => void;
  addInput: () => void;
  removeInput: (idx: number) => void;
  clearInputs: () => void;
  setBatchMode: (b: boolean) => void;
  setBatchText: (s: string) => void;
  patchParams: (p: Partial<EmbeddingsParams>) => void;
  setLoading: (b: boolean) => void;
  setResult: (r: number[][] | null) => void;
  setError: (s: string | null) => void;
  reset: () => void;
}

const initial = {
  selectedConnectionId: null,
  inputs: [""],
  batchMode: false,
  params: {} as EmbeddingsParams,
  loading: false,
  result: null as number[][] | null,
  error: null as string | null,
};

export const useEmbeddingsStore = create<EmbeddingsStoreState>((set) => ({
  ...initial,
  setSelected: (id) => set({ selectedConnectionId: id }),
  setInputAt: (idx, text) =>
    set((s) => {
      const next = s.inputs.slice();
      next[idx] = text;
      return { inputs: next };
    }),
  addInput: () => set((s) => ({ inputs: [...s.inputs, ""] })),
  removeInput: (idx) =>
    set((s) => {
      const next = s.inputs.filter((_, i) => i !== idx);
      return { inputs: next.length > 0 ? next : [""] };
    }),
  clearInputs: () => set({ inputs: [""] }),
  setBatchMode: (b) => set({ batchMode: b }),
  setBatchText: (s) =>
    set({
      inputs: s
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    }),
  patchParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
  setLoading: (b) => set({ loading: b }),
  setResult: (r) => set({ result: r }),
  setError: (e) => set({ error: e }),
  reset: () => set({ ...initial, inputs: [""] }),
}));
