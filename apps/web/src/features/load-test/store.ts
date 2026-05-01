import type { EndpointValues } from "@/lib/endpoint-values";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ApiType, LoadTestResult } from "./types";

export interface LoadTestSlice {
  selectedConnectionId: string | null;
  manualEndpoint: EndpointValues;
  apiType: ApiType;
  chat: {
    prompt: string;
    maxTokens: number;
    temperature: number;
    stream: boolean;
  };
  embeddings: { embeddingInput: string };
  rerank: { rerankQuery: string; rerankTexts: string };
  images: { imagePrompt: string; imageSize: string; imageN: number };
  chatVision: {
    imageUrl: string;
    prompt: string;
    systemPrompt: string;
    maxTokens: number;
    temperature: number;
  };
  chatAudio: { prompt: string; systemPrompt: string };
  attack: { rate: number; duration: number };
  curlInput: string;
  /** Last successful attack result. Transient — not persisted. */
  lastResult: LoadTestResult | null;
  /** Last attack error message. Transient — not persisted. */
  error: string | null;
  /** Attack progress 0–100. Transient — not persisted. */
  progress: number;
  setSelected: (id: string | null) => void;
  setApiType: (t: ApiType) => void;
  patch: <K extends keyof LoadTestSlice>(key: K, value: LoadTestSlice[K]) => void;
  setLastResult: (r: LoadTestResult | null) => void;
  setError: (e: string | null) => void;
  setProgress: (p: number) => void;
  /** Clear attack outputs only (result + error + progress). Preserves form config. */
  resetResults: () => void;
  /** Full reset to factory defaults, including form config and selection. */
  reset: () => void;
}

const emptyManualEndpoint: EndpointValues = {
  apiBaseUrl: "",
  apiKey: "",
  model: "",
  customHeaders: "",
  queryParams: "",
};

const INITIAL = {
  selectedConnectionId: null as string | null,
  manualEndpoint: emptyManualEndpoint,
  apiType: "chat" as ApiType,
  chat: {
    prompt: "What is the meaning of life?",
    maxTokens: 1000,
    temperature: 0.7,
    stream: false,
  },
  embeddings: { embeddingInput: "What is Deep Learning?" },
  rerank: {
    rerankQuery: "What is Deep Learning?",
    rerankTexts:
      "Deep learning is a subset of machine learning\nParis is the capital of France\nNeural networks use backpropagation",
  },
  images: { imagePrompt: "a cute cat", imageSize: "1024x1024", imageN: 1 },
  chatVision: {
    imageUrl: "https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen-VL/assets/demo.jpeg",
    prompt: "What is in the image? Answer in one sentence.",
    systemPrompt: "",
    maxTokens: 256,
    temperature: 0,
  },
  chatAudio: {
    prompt: "Say the word hello.",
    systemPrompt: "You are Qwen, a virtual human capable of generating text and speech.",
  },
  attack: { rate: 2, duration: 60 },
  curlInput: "",
  lastResult: null as LoadTestResult | null,
  error: null as string | null,
  progress: 0,
};

export const useLoadTestStore = create<LoadTestSlice>()(
  persist(
    (set) => ({
      ...INITIAL,
      setSelected: (id) => set({ selectedConnectionId: id }),
      setApiType: (t) => set({ apiType: t }),
      patch: (key, value) => set({ [key]: value } as Partial<LoadTestSlice>),
      setLastResult: (r) => set({ lastResult: r }),
      setError: (e) => set({ error: e }),
      setProgress: (p) => set({ progress: p }),
      resetResults: () => set({ lastResult: null, error: null, progress: 0 }),
      reset: () => set(INITIAL),
    }),
    {
      name: "md.load-test.v1",
      version: 1,
      partialize: (s) => ({
        selectedConnectionId: s.selectedConnectionId,
        manualEndpoint: s.manualEndpoint,
        apiType: s.apiType,
        chat: s.chat,
        embeddings: s.embeddings,
        rerank: s.rerank,
        images: s.images,
        chatVision: s.chatVision,
        chatAudio: s.chatAudio,
        attack: s.attack,
        curlInput: s.curlInput,
        // lastResult / error / progress are transient — not persisted
      }),
    },
  ),
);
