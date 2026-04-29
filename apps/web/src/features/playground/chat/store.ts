import type { ChatMessage, ChatParams } from "@modeldoctor/contracts";
import { create } from "zustand";

/**
 * OpenAI-documented defaults for the 5 sliderable chat params. These are
 * pre-loaded into the store so the input boxes and slider thumbs stay in
 * sync from the very first render. `seed` and `stop` are intentionally
 * excluded — they have no meaningful default.
 *
 * Note: backend's buildBody only sends fields where value !== undefined,
 * so loading these defaults DOES send them to the upstream. For an
 * OpenAI-compatible server this is a no-op (server would have used the
 * same default if the field were absent), but it makes the wire payload
 * slightly larger and is observable in the network tab.
 */
export const DEFAULT_CHAT_PARAMS: ChatParams = {
  temperature: 1,
  maxTokens: 1024,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
};

export interface ChatStoreState {
  selectedConnectionId: string | null;
  systemMessage: string;
  messages: ChatMessage[];
  params: ChatParams;
  sending: boolean;
  error: string | null;
  setSelected: (id: string | null) => void;
  setSystemMessage: (s: string) => void;
  appendMessage: (m: ChatMessage) => void;
  clearMessages: () => void;
  patchParams: (p: Partial<ChatParams>) => void;
  setSending: (b: boolean) => void;
  setError: (s: string | null) => void;
  reset: () => void;
}

const initial = {
  selectedConnectionId: null,
  systemMessage: "",
  messages: [] as ChatMessage[],
  params: { ...DEFAULT_CHAT_PARAMS },
  sending: false,
  error: null as string | null,
};

export const useChatStore = create<ChatStoreState>((set) => ({
  ...initial,
  setSelected: (id) => set({ selectedConnectionId: id }),
  setSystemMessage: (s) => set({ systemMessage: s }),
  appendMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  clearMessages: () => set({ messages: [] }),
  patchParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
  setSending: (b) => set({ sending: b }),
  setError: (e) => set({ error: e }),
  reset: () => set({ ...initial }),
}));
