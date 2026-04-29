import { PageHeader } from "@/components/common/page-header";
import { ApiError, api } from "@/lib/api-client";
import { useConnectionsStore } from "@/stores/connections-store";
import type {
  ChatMessage,
  PlaygroundChatRequest,
  PlaygroundChatResponse,
} from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CategoryEndpointSelector } from "../CategoryEndpointSelector";
import { PlaygroundShell } from "../PlaygroundShell";
import { ChatParams } from "./ChatParams";
import { MessageComposer } from "./MessageComposer";
import { MessageList } from "./MessageList";
import { useChatStore } from "./store";

export function ChatPage() {
  const { t } = useTranslation("playground");
  const slice = useChatStore();
  const conn = useConnectionsStore((s) =>
    slice.selectedConnectionId ? s.get(slice.selectedConnectionId) : null,
  );

  const canSend = !!conn;
  const disabledReason = canSend ? undefined : t("chat.composer.needConnection");

  const onSend = async (text: string) => {
    if (!conn) return;
    slice.appendMessage({ role: "user", content: text });
    slice.setSending(true);
    slice.setError(null);

    const messages: ChatMessage[] = [
      ...(slice.systemMessage.trim()
        ? [{ role: "system" as const, content: slice.systemMessage.trim() }]
        : []),
      ...slice.messages,
      { role: "user" as const, content: text },
    ];

    const body: PlaygroundChatRequest = {
      apiBaseUrl: conn.apiBaseUrl,
      apiKey: conn.apiKey,
      model: conn.model,
      customHeaders: conn.customHeaders || undefined,
      queryParams: conn.queryParams || undefined,
      messages,
      params: slice.params,
    };
    try {
      const res = await api.post<PlaygroundChatResponse>("/api/playground/chat", body);
      if (res.success) {
        slice.appendMessage({ role: "assistant", content: res.content ?? "" });
      } else {
        const msg = res.error ?? "unknown";
        slice.setError(msg);
        toast.error(t("chat.errors.send", { message: msg }));
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "network";
      slice.setError(msg);
      toast.error(t("chat.errors.send", { message: msg }));
    } finally {
      slice.setSending(false);
    }
  };

  return (
    <PlaygroundShell
      category="chat"
      paramsSlot={
        <div className="space-y-4">
          <CategoryEndpointSelector
            category="chat"
            selectedConnectionId={slice.selectedConnectionId}
            onSelect={slice.setSelected}
          />
          <ChatParams value={slice.params} onChange={slice.patchParams} />
        </div>
      }
    >
      <PageHeader title={t("chat.title")} subtitle={t("chat.subtitle")} />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto">
          <MessageList messages={slice.messages} />
          {slice.error ? (
            <div className="mx-6 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {slice.error}
            </div>
          ) : null}
        </div>
        <MessageComposer
          systemMessage={slice.systemMessage}
          onSystemMessageChange={slice.setSystemMessage}
          onSend={onSend}
          sending={slice.sending}
          disabled={!canSend}
          disabledReason={disabledReason}
        />
      </div>
    </PlaygroundShell>
  );
}
