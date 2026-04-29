import type { ChatMessage, ChatParams } from "@modeldoctor/contracts";
import { createHistoryStore } from "../history/createHistoryStore";

export interface ChatHistorySnapshot {
  systemMessage: string;
  messages: ChatMessage[];
  params: ChatParams;
  selectedConnectionId: string | null;
}

export const useChatHistoryStore = createHistoryStore<ChatHistorySnapshot>({
  name: "md-playground-history-chat",
  blank: () => ({
    systemMessage: "",
    messages: [],
    params: {
      temperature: 1,
      maxTokens: 1024,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      stream: true,
    },
    selectedConnectionId: null,
  }),
  preview: (s) => {
    const lastUser = [...s.messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return "";
    const turns = s.messages.filter((m) => m.role === "user").length;
    const text =
      typeof lastUser.content === "string" ? lastUser.content.slice(0, 80) : "[multimodal]";
    return turns > 1 ? `${turns} turns · ${text}` : text;
  },
});
