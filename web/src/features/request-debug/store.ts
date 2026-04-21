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
	lastResponse: DebugResponse | null;
	lastError: string | null;
	setSelected: (id: string | null) => void;
	patch: <K extends keyof DebugState>(key: K, value: DebugState[K]) => void;
	setLastResponse: (r: DebugResponse | null) => void;
	setLastError: (e: string | null) => void;
}

export const useDebugStore = create<DebugState>()(
	persist(
		(set) => ({
			selectedConnectionId: null,
			curlInput: "",
			method: "POST",
			url: "",
			headers: [
				{ key: "Content-Type", value: "application/json", enabled: true },
			],
			query: [],
			body: "",
			lastResponse: null,
			lastError: null,
			setSelected: (id) => set({ selectedConnectionId: id }),
			patch: (key, value) => set({ [key]: value } as Partial<DebugState>),
			setLastResponse: (r) => set({ lastResponse: r, lastError: null }),
			setLastError: (e) => set({ lastError: e, lastResponse: null }),
		}),
		{ name: "md.debug.v1" },
	),
);
