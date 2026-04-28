import { type EndpointValues, emptyEndpointValues } from "@/types/connection";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProbeCategory, ProbeName, ProbeResult } from "./types";

interface E2EState {
  selectedConnectionId: string | null;
  manualEndpoint: EndpointValues;
  selectedCategory: ProbeCategory;
  /** Per-probe path override; missing keys → use the contract's default. */
  pathOverrides: Partial<Record<ProbeName, string>>;
  results: Partial<Record<ProbeName, ProbeResult | null>>;
  running: Partial<Record<ProbeName, boolean>>;
  setSelected: (id: string | null) => void;
  setManualEndpoint: (values: EndpointValues) => void;
  setSelectedCategory: (cat: ProbeCategory) => void;
  setPathOverride: (probe: ProbeName, path: string) => void;
  clearPathOverride: (probe: ProbeName) => void;
  setRunning: (name: ProbeName, running: boolean) => void;
  setResult: (name: ProbeName, r: ProbeResult | null) => void;
  /** Clear probe outputs only (results + running). Preserves endpoint, category, overrides. */
  resetResults: () => void;
  /** Full reset to factory defaults. */
  reset: () => void;
}

const INITIAL = {
  selectedConnectionId: null as string | null,
  manualEndpoint: emptyEndpointValues,
  selectedCategory: "chat" as ProbeCategory,
  pathOverrides: {} as Partial<Record<ProbeName, string>>,
  results: {} as Partial<Record<ProbeName, ProbeResult | null>>,
  running: {} as Partial<Record<ProbeName, boolean>>,
};

export const useE2EStore = create<E2EState>()(
  persist(
    (set) => ({
      ...INITIAL,
      setSelected: (id) => set({ selectedConnectionId: id }),
      setManualEndpoint: (values) => set({ manualEndpoint: values }),
      setSelectedCategory: (cat) => set({ selectedCategory: cat }),
      setPathOverride: (probe, path) =>
        set((s) => ({ pathOverrides: { ...s.pathOverrides, [probe]: path } })),
      clearPathOverride: (probe) =>
        set((s) => {
          const next = { ...s.pathOverrides };
          delete next[probe];
          return { pathOverrides: next };
        }),
      setRunning: (name, running) => set((s) => ({ running: { ...s.running, [name]: running } })),
      setResult: (name, r) => set((s) => ({ results: { ...s.results, [name]: r } })),
      resetResults: () => set({ results: {}, running: {} }),
      reset: () => set(INITIAL),
    }),
    {
      // v2 bump: probe naming changed (text → chat-text, etc.). Old v1 state
      // had no migration path worth preserving — drop and reseed.
      name: "md.e2e.v2",
      version: 2,
      partialize: (s) => ({
        selectedConnectionId: s.selectedConnectionId,
        manualEndpoint: s.manualEndpoint,
        selectedCategory: s.selectedCategory,
        pathOverrides: s.pathOverrides,
      }),
    },
  ),
);
