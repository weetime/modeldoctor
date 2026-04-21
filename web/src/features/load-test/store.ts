import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ApiType, LoadTestResult } from "./types";

export interface ManualEndpoint {
	apiUrl: string;
	apiKey: string;
	model: string;
	customHeaders: string;
	queryParams: string;
}

export interface LoadTestSlice {
	selectedConnectionId: string | null;
	manualEndpoint: ManualEndpoint;
	modified: boolean;
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
	curlExpanded: boolean;
	curlInput: string;
	lastResult: LoadTestResult | null;
	setSelected: (id: string | null) => void;
	setModified: (m: boolean) => void;
	setApiType: (t: ApiType) => void;
	patch: <K extends keyof LoadTestSlice>(
		key: K,
		value: LoadTestSlice[K],
	) => void;
	setLastResult: (r: LoadTestResult | null) => void;
}

const emptyManualEndpoint: ManualEndpoint = {
	apiUrl: "",
	apiKey: "",
	model: "",
	customHeaders: "",
	queryParams: "",
};

const defaults = {
	selectedConnectionId: null,
	manualEndpoint: emptyManualEndpoint,
	modified: false,
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
		imageUrl:
			"https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen-VL/assets/demo.jpeg",
		prompt: "What is in the image? Answer in one sentence.",
		systemPrompt: "",
		maxTokens: 256,
		temperature: 0,
	},
	chatAudio: {
		prompt: "Say the word hello.",
		systemPrompt:
			"You are Qwen, a virtual human capable of generating text and speech.",
	},
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
