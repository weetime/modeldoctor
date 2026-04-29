import type { ChatMessage, ChatParams } from "@modeldoctor/contracts";
import { create } from "zustand";

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
  params: {} as ChatParams,
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
