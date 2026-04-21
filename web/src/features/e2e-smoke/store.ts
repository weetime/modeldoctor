import { type EndpointValues, emptyEndpointValues } from "@/types/connection";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProbeName, ProbeResult } from "./types";

interface E2EState {
	selectedConnectionId: string | null;
	manualEndpoint: EndpointValues;
	results: Record<ProbeName, ProbeResult | null>;
	running: Record<ProbeName, boolean>;
	setSelected: (id: string | null) => void;
	setManualEndpoint: (values: EndpointValues) => void;
	setRunning: (name: ProbeName, running: boolean) => void;
	setResult: (name: ProbeName, r: ProbeResult | null) => void;
	clearAll: () => void;
}

export const useE2EStore = create<E2EState>()(
	persist(
		(set) => ({
			selectedConnectionId: null,
			manualEndpoint: emptyEndpointValues,
			results: { text: null, image: null, audio: null },
			running: { text: false, image: false, audio: false },
			setSelected: (id) => set({ selectedConnectionId: id }),
			setManualEndpoint: (values) => set({ manualEndpoint: values }),
			setRunning: (name, running) =>
				set((s) => ({ running: { ...s.running, [name]: running } })),
			setResult: (name, r) =>
				set((s) => ({ results: { ...s.results, [name]: r } })),
			clearAll: () =>
				set({
					results: { text: null, image: null, audio: null },
					running: { text: false, image: false, audio: false },
				}),
		}),
		{ name: "md.e2e.v1" },
	),
);
