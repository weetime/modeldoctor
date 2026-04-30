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

export interface InpaintState {
  /** Source-image filename (purely for display; the actual blob is in a ref). */
  imageName: string | null;
  imageMimeType: string | null;
  brushSize: number;
  prompt: string;
  loading: boolean;
  results: ImageArtifact[];
  error: string | null;
}

export interface ImageStoreState {
  selectedConnectionId: string | null;
  prompt: string;
  params: ImageParams;
  loading: boolean;
  results: ImageArtifact[];
  error: string | null;
  inpaint: InpaintState;
  setSelected: (id: string | null) => void;
  setPrompt: (s: string) => void;
  patchParams: (p: Partial<ImageParams>) => void;
  setLoading: (b: boolean) => void;
  setResults: (r: ImageArtifact[]) => void;
  setError: (s: string | null) => void;
  patchInpaint: (p: Partial<InpaintState>) => void;
  resetInpaint: () => void;
  reset: () => void;
}

const initialInpaint: InpaintState = {
  imageName: null,
  imageMimeType: null,
  brushSize: 30,
  prompt: "",
  loading: false,
  results: [],
  error: null,
};

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
  inpaint: { ...initialInpaint },
};

export const useImageStore = create<ImageStoreState>((set) => ({
  ...initial,
  setSelected: (id) => set({ selectedConnectionId: id }),
  setPrompt: (s) => set({ prompt: s }),
  patchParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
  setLoading: (b) => set({ loading: b }),
  setResults: (r) => set({ results: r }),
  setError: (e) => set({ error: e }),
  patchInpaint: (p) => set((s) => ({ inpaint: { ...s.inpaint, ...p } })),
  resetInpaint: () => set({ inpaint: { ...initialInpaint } }),
  reset: () => set({ ...initial, inpaint: { ...initialInpaint } }),
}));
