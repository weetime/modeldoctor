import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ApiType, LoadTestResult } from "./types";

export interface LoadTestSlice {
	selectedConnectionId: string | null;
	modified: boolean;
	apiType: ApiType;
	chat: { prompt: string; maxTokens: number; temperature: number; stream: boolean };
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
	curlExpanded: boolean;
	curlInput: string;
	lastResult: LoadTestResult | null;
	setSelected: (id: string | null) => void;
	setModified: (m: boolean) => void;
	setApiType: (t: ApiType) => void;
	patch: <K extends keyof LoadTestSlice>(key: K, value: LoadTestSlice[K]) => void;
	setLastResult: (r: LoadTestResult | null) => void;
}

const defaults = {
	selectedConnectionId: null,
	modified: false,
	apiType: "chat" as ApiType,
	chat: { prompt: "", maxTokens: 1000, temperature: 0.7, stream: false },
	embeddings: { embeddingInput: "" },
	rerank: { rerankQuery: "", rerankTexts: "" },
	images: { imagePrompt: "", imageSize: "1024x1024", imageN: 1 },
	chatVision: {
		imageUrl: "",
		prompt: "",
		systemPrompt: "",
		maxTokens: 256,
		temperature: 0,
	},
	chatAudio: { prompt: "", systemPrompt: "" },
	attack: { rate: 2, duration: 60 },
	curlExpanded: false,
	curlInput: "",
	lastResult: null as LoadTestResult | null,
};

export const useLoadTestStore = create<LoadTestSlice>()(
	persist(
		(set) => ({
			...defaults,
			setSelected: (id) => set({ selectedConnectionId: id, modified: false }),
			setModified: (m) => set({ modified: m }),
			setApiType: (t) => set({ apiType: t }),
			patch: (key, value) => set({ [key]: value } as Partial<LoadTestSlice>),
			setLastResult: (r) => set({ lastResult: r }),
		}),
		{ name: "md.load-test.v1" },
	),
);
