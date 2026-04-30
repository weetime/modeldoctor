import { PageHeader } from "@/components/common/page-header";
import { ApiError, api } from "@/lib/api-client";
import { playgroundFetchStream } from "@/lib/playground-stream";
import { useConnectionsStore } from "@/stores/connections-store";
import type {
  ChatMessage,
  PlaygroundChatRequest,
  PlaygroundChatResponse,
} from "@modeldoctor/contracts";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CategoryEndpointSelector } from "../CategoryEndpointSelector";
import { PlaygroundShell } from "../PlaygroundShell";
import { genChatSnippets } from "../code-snippets/chat";
import { HistoryDrawer } from "../history/HistoryDrawer";
import { ChatParams } from "./ChatParams";
import { MessageComposer } from "./MessageComposer";
import { MessageList } from "./MessageList";
import { type AttachedFile, buildContentParts } from "./attachments";
import { type ChatHistorySnapshot, useChatHistoryStore } from "./history";
import { useChatStore } from "./store";

export function ChatPage() {
  const { t } = useTranslation("playground");
  const slice = useChatStore();
  const conn = useConnectionsStore((s) =>
    slice.selectedConnectionId ? s.get(slice.selectedConnectionId) : null,
  );

  const canSend = !!conn;
  const disabledReason = canSend ? undefined : t("chat.composer.needConnection");

  const restoreSnap = (snap: ChatHistorySnapshot) => {
    // Replace store state with the restored snapshot
    const s = useChatStore.getState();
    s.reset();
    s.setSystemMessage(snap.systemMessage);
    s.patchParams(snap.params);
    s.setSelected(snap.selectedConnectionId);
    for (const m of snap.messages) s.appendMessage(m);
  };

  const historyCurrentId = useChatHistoryStore((h) => h.currentId);
  const historyRestoreVersion = useChatHistoryStore((h) => h.restoreVersion);
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are intentional — restoreVersion handles in-place snapshot replacement (newSession / restore) without re-firing on routine save/scheduleAutoSave
  useEffect(() => {
    const snap = useChatHistoryStore.getState().list.find((e) => e.id === historyCurrentId);
    if (snap) restoreSnap(snap.snapshot);
  }, [historyCurrentId, historyRestoreVersion]);

  // Auto-save chat state into the current history entry (debounced 1500ms inside the store)
  useEffect(() => {
    useChatHistoryStore.getState().scheduleAutoSave({
      systemMessage: slice.systemMessage,
      messages: slice.messages,
      params: slice.params,
      selectedConnectionId: slice.selectedConnectionId,
    });
  }, [slice.systemMessage, slice.messages, slice.params, slice.selectedConnectionId]);

  const snippets =
    conn != null
      ? genChatSnippets({
          apiBaseUrl: conn.apiBaseUrl,
          model: conn.model,
          messages: [
            ...(slice.systemMessage.trim()
              ? [{ role: "system" as const, content: slice.systemMessage.trim() }]
              : []),
            ...slice.messages,
          ],
          params: slice.params,
        })
      : null;

  const onSend = async (text: string, attachments: AttachedFile[]) => {
    // Read everything fresh from the store to avoid stale-closure bugs.
    const fresh = useChatStore.getState();
    const connNow = fresh.selectedConnectionId
      ? useConnectionsStore.getState().get(fresh.selectedConnectionId)
      : null;
    if (!connNow) return;

    const content = buildContentParts(text, attachments);
    fresh.appendMessage({ role: "user", content });
    fresh.setSending(true);
    fresh.setError(null);

    // After the appendMessage above, the freshest messages list is:
    const stateAfterAppend = useChatStore.getState();
    const messages: ChatMessage[] = [
      ...(stateAfterAppend.systemMessage.trim()
        ? [{ role: "system" as const, content: stateAfterAppend.systemMessage.trim() }]
        : []),
      ...stateAfterAppend.messages,
    ];

    const body: PlaygroundChatRequest = {
      apiBaseUrl: connNow.apiBaseUrl,
      apiKey: connNow.apiKey,
      model: connNow.model,
      customHeaders: connNow.customHeaders || undefined,
      queryParams: connNow.queryParams || undefined,
      messages,
      params: stateAfterAppend.params,
    };

    if (stateAfterAppend.params.stream) {
      const ac = new AbortController();
      fresh.setStreaming(true);
      fresh.setAbortController(ac);
      try {
        await playgroundFetchStream({
          path: "/api/playground/chat",
          body,
          signal: ac.signal,
          onSseEvent: (data) => {
            if (data === "[DONE]") return;
            try {
              const evt = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const tok = evt.choices?.[0]?.delta?.content;
              if (tok) useChatStore.getState().appendAssistantToken(tok);
            } catch {
              // Ignore non-JSON SSE comments.
            }
          },
        });
      } catch (e) {
        // AbortError is expected when user clicks Stop; do not toast.
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          const msg = e instanceof Error ? e.message : "stream failed";
          useChatStore.getState().setError(msg);
          toast.error(t("chat.errors.send", { message: msg }));
        }
      } finally {
        const s = useChatStore.getState();
        s.setStreaming(false);
        s.setAbortController(null);
        s.setSending(false);
      }
      return;
    }

    // Non-streaming path
    try {
      const res = await api.post<PlaygroundChatResponse>("/api/playground/chat", body);
      if (res.success) {
        useChatStore.getState().appendMessage({
          role: "assistant",
          content: res.content ?? "",
        });
      } else {
        const msg = res.error ?? "unknown";
        useChatStore.getState().setError(msg);
        toast.error(t("chat.errors.send", { message: msg }));
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "network";
      useChatStore.getState().setError(msg);
      toast.error(t("chat.errors.send", { message: msg }));
    } finally {
      useChatStore.getState().setSending(false);
    }
  };

  const onStop = () => {
    useChatStore.getState().abortController?.abort();
  };

  return (
    <PlaygroundShell
      category="chat"
      viewCodeSnippets={snippets}
      historySlot={<HistoryDrawer useHistoryStore={useChatHistoryStore} />}
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
          onStop={onStop}
          sending={slice.sending}
          streaming={slice.streaming}
          disabled={!canSend}
          disabledReason={disabledReason}
        />
      </div>
    </PlaygroundShell>
  );
}
