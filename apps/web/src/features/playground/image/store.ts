import { create } from "zustand";

export interface ImageParams {
  size: string;
  n: number;
  seed?: number;
  responseFormat?: "url" | "b64_json";
  randomSeedEachRequest: boolean;
}

export interface ImageArtifact {
  url?: string;
  b64Json?: string;
}

export interface ImageStoreState {
  selectedConnectionId: string | null;
  prompt: string;
  params: ImageParams;
  loading: boolean;
  results: ImageArtifact[];
  error: string | null;
  setSelected: (id: string | null) => void;
  setPrompt: (s: string) => void;
  patchParams: (p: Partial<ImageParams>) => void;
  setLoading: (b: boolean) => void;
  setResults: (r: ImageArtifact[]) => void;
  setError: (s: string | null) => void;
  reset: () => void;
}

const initial = {
  selectedConnectionId: null,
  prompt: "",
  params: {
    size: "512x512",
    n: 1,
    randomSeedEachRequest: true,
  } as ImageParams,
  loading: false,
  results: [] as ImageArtifact[],
  error: null as string | null,
};

export const useImageStore = create<ImageStoreState>((set) => ({
  ...initial,
  setSelected: (id) => set({ selectedConnectionId: id }),
  setPrompt: (s) => set({ prompt: s }),
  patchParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
  setLoading: (b) => set({ loading: b }),
  setResults: (r) => set({ results: r }),
  setError: (e) => set({ error: e }),
  reset: () => set({ ...initial }),
}));
