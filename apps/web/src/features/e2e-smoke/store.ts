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
  /** Clear probe outputs only (results + running). Preserves endpoint & selection. */
  resetResults: () => void;
  /** Full reset to factory defaults, including endpoint and selection. */
  reset: () => void;
}

const INITIAL_RESULTS: E2EState["results"] = {
  text: null,
  image: null,
  audio: null,
};
const INITIAL_RUNNING: E2EState["running"] = {
  text: false,
  image: false,
  audio: false,
};
const INITIAL = {
  selectedConnectionId: null as string | null,
  manualEndpoint: emptyEndpointValues,
  results: INITIAL_RESULTS,
  running: INITIAL_RUNNING,
};

export const useE2EStore = create<E2EState>()(
  persist(
    (set) => ({
      ...INITIAL,
      setSelected: (id) => set({ selectedConnectionId: id }),
      setManualEndpoint: (values) => set({ manualEndpoint: values }),
      setRunning: (name, running) => set((s) => ({ running: { ...s.running, [name]: running } })),
      setResult: (name, r) => set((s) => ({ results: { ...s.results, [name]: r } })),
      resetResults: () => set({ results: INITIAL_RESULTS, running: INITIAL_RUNNING }),
      reset: () => set(INITIAL),
    }),
    {
      name: "md.e2e.v1",
      version: 1,
      partialize: (s) => ({
        selectedConnectionId: s.selectedConnectionId,
        manualEndpoint: s.manualEndpoint,
      }),
    },
  ),
);
