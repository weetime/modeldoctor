import type { ChatMessage, ChatParams } from "@modeldoctor/contracts";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PanelCount = 2 | 3 | 4;

export interface PanelState {
  // Persisted
  selectedConnectionId: string | null;
  params: ChatParams;
  // Ephemeral (rehydrate → blank)
  messages: ChatMessage[];
  sending: boolean;
  streaming: boolean;
  abortController: AbortController | null;
  error: string | null;
}

const blankPanel = (): PanelState => ({
  selectedConnectionId: null,
  params: {},
  messages: [],
  sending: false,
  streaming: false,
  abortController: null,
  error: null,
});

export interface CompareStoreState {
  panelCount: PanelCount;
  panels: PanelState[];
  sharedSystemMessage: string;

  setPanelCount: (n: PanelCount) => void;
  setSharedSystemMessage: (s: string) => void;
  setPanelConnection: (i: number, id: string | null) => void;
  patchPanelParams: (i: number, p: Partial<ChatParams>) => void;
  appendMessageToPanel: (i: number, m: ChatMessage) => void;
  appendAssistantTokenToPanel: (i: number, tok: string) => void;
  clearPanelMessages: (i: number) => void;
  clearAllMessages: () => void;
  setPanelSending: (i: number, b: boolean) => void;
  setPanelStreaming: (i: number, b: boolean) => void;
  setPanelAbortController: (i: number, ac: AbortController | null) => void;
  setPanelError: (i: number, e: string | null) => void;
  resetPanel: (i: number) => void;
  abortAll: () => void;
}

const updatePanel = (panels: PanelState[], i: number, patch: Partial<PanelState>): PanelState[] =>
  panels.map((p, idx) => (idx === i ? { ...p, ...patch } : p));

export const useCompareStore = create<CompareStoreState>()(
  persist(
    (set, get) => ({
      panelCount: 2,
      panels: [blankPanel(), blankPanel()],
      sharedSystemMessage: "",

      setPanelCount: (n) =>
        set((s) => {
          if (n === s.panelCount) return s;
          if (n > s.panelCount) {
            return {
              panelCount: n,
              panels: [...s.panels, ...Array.from({ length: n - s.panelCount }, () => blankPanel())],
            };
          }
          // shrink — abort any panels we're about to drop
          for (let i = n; i < s.panels.length; i++) {
            s.panels[i].abortController?.abort();
          }
          return { panelCount: n, panels: s.panels.slice(0, n) };
        }),

      setSharedSystemMessage: (msg) => set({ sharedSystemMessage: msg }),

      setPanelConnection: (i, id) =>
        set((s) => ({ panels: updatePanel(s.panels, i, { selectedConnectionId: id }) })),

      patchPanelParams: (i, p) =>
        set((s) => ({
          panels: s.panels.map((panel, idx) =>
            idx === i ? { ...panel, params: { ...panel.params, ...p } } : panel,
          ),
        })),

      appendMessageToPanel: (i, m) =>
        set((s) => ({
          panels: s.panels.map((panel, idx) =>
            idx === i ? { ...panel, messages: [...panel.messages, m] } : panel,
          ),
        })),

      appendAssistantTokenToPanel: (i, tok) =>
        set((s) => ({
          panels: s.panels.map((panel, idx) => {
            if (idx !== i) return panel;
            const last = panel.messages.at(-1);
            if (last && last.role === "assistant" && typeof last.content === "string") {
              const updated: ChatMessage = { ...last, content: last.content + tok };
              return { ...panel, messages: [...panel.messages.slice(0, -1), updated] };
            }
            return { ...panel, messages: [...panel.messages, { role: "assistant", content: tok }] };
          }),
        })),

      clearPanelMessages: (i) => set((s) => ({ panels: updatePanel(s.panels, i, { messages: [] }) })),

      clearAllMessages: () =>
        set((s) => ({ panels: s.panels.map((p) => ({ ...p, messages: [] })) })),

      setPanelSending: (i, b) => set((s) => ({ panels: updatePanel(s.panels, i, { sending: b }) })),
      setPanelStreaming: (i, b) =>
        set((s) => ({ panels: updatePanel(s.panels, i, { streaming: b }) })),
      setPanelAbortController: (i, ac) =>
        set((s) => ({ panels: updatePanel(s.panels, i, { abortController: ac }) })),
      setPanelError: (i, e) => set((s) => ({ panels: updatePanel(s.panels, i, { error: e }) })),

      resetPanel: (i) => set((s) => ({ panels: updatePanel(s.panels, i, blankPanel()) })),

      abortAll: () => {
        const { panels } = get();
        for (const p of panels) p.abortController?.abort();
      },
    }),
    {
      name: "md-playground-chat-compare-layout",
      version: 1,
      partialize: (s) => ({
        panelCount: s.panelCount,
        sharedSystemMessage: s.sharedSystemMessage,
        panels: s.panels.map((p) => ({
          selectedConnectionId: p.selectedConnectionId,
          params: p.params,
        })),
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<{
          panelCount: PanelCount;
          sharedSystemMessage: string;
          panels: Array<Pick<PanelState, "selectedConnectionId" | "params">>;
        }>;
        const persistedPanels = p.panels ?? current.panels;
        return {
          ...current,
          ...p,
          panels: persistedPanels.map((pp) => ({
            ...blankPanel(),
            selectedConnectionId: pp.selectedConnectionId,
            params: pp.params,
          })),
        };
      },
    },
  ),
);
