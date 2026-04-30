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
import { ChatModeTabs } from "../chat-compare/ChatModeTabs";
import { genChatSnippets } from "../code-snippets/chat";
import { HistoryDrawer } from "../history/HistoryDrawer";
import {
  applyBlobPatches,
  persistMessageAttachments,
  rehydrateMessageBlobs,
} from "../history/persistAttachments";
import { ChatParams } from "./ChatParams";
import { MessageComposer } from "./MessageComposer";
import { MessageList } from "./MessageList";
import { type AttachedFile, buildContentParts } from "./attachments";
import { type ChatHistorySnapshot, useChatHistoryStore } from "./history";
import { useChatStore } from "./store";

/**
 * Walk message content parts, store each binary part as a Blob in IDB, and
 * replace the inline data with an `idb://<key>` sentinel.
 *
 * Returns a new snapshot safe for JSON serialisation without large base64 blobs.
 */
export async function persistAttachments(
  entryId: string,
  snap: ChatHistorySnapshot,
): Promise<ChatHistorySnapshot> {
  const store = useChatHistoryStore.getState();
  const sanitisedMessages = await persistMessageAttachments(entryId, snap.messages, store);
  return { ...snap, messages: sanitisedMessages };
}

/**
 * Reverse `persistAttachments`: for every content-part field that begins with
 * `idb://`, fetch the Blob, convert back to data URL, and inject into the
 * current chat store state. Runs asynchronously after the sync restore call.
 */
export async function rehydrateChatBlobs(
  entryId: string,
  snap: ChatHistorySnapshot,
): Promise<void> {
  const store = useChatHistoryStore.getState();
  const patches = await rehydrateMessageBlobs(entryId, snap.messages, store);
  if (patches.length === 0) return;

  // Snapshot current non-message state before reset, then apply patches to messages.
  const chatState = useChatStore.getState();
  const systemMessage = chatState.systemMessage;
  const params = chatState.params;
  const selectedConnectionId = chatState.selectedConnectionId;
  const msgs = applyBlobPatches(chatState.messages as ChatMessage[], patches);

  // Rebuild the store with patched messages (reset wipes all, then re-apply).
  chatState.reset();
  chatState.setSystemMessage(systemMessage);
  chatState.patchParams(params);
  chatState.setSelected(selectedConnectionId);
  for (const m of msgs) chatState.appendMessage(m);
}

export function ChatPage() {
  const { t } = useTranslation("playground");
  const slice = useChatStore();
  const conn = useConnectionsStore((s) =>
    slice.selectedConnectionId ? s.get(slice.selectedConnectionId) : null,
  );

  const canSend = !!conn;
  const disabledReason = canSend ? undefined : t("chat.composer.needConnection");

  const restoreSnap = (entryId: string, snap: ChatHistorySnapshot) => {
    // Sync state copy first, then async blob rehydration.
    const s = useChatStore.getState();
    s.reset();
    s.setSystemMessage(snap.systemMessage);
    s.patchParams(snap.params);
    s.setSelected(snap.selectedConnectionId);
    for (const m of snap.messages) s.appendMessage(m);
    // Kick off async rehydration; errors are non-fatal (blobs may not exist for older entries).
    rehydrateChatBlobs(entryId, snap).catch((e) =>
      console.error("[ChatPage] blob rehydration failed", e),
    );
  };

  const historyCurrentId = useChatHistoryStore((h) => h.currentId);
  const historyRestoreVersion = useChatHistoryStore((h) => h.restoreVersion);
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are intentional — restoreVersion handles in-place snapshot replacement (newSession / restore) without re-firing on routine save/scheduleAutoSave
  useEffect(() => {
    const entry = useChatHistoryStore.getState().list.find((e) => e.id === historyCurrentId);
    if (entry) restoreSnap(entry.id, entry.snapshot);
  }, [historyCurrentId, historyRestoreVersion]);

  // Auto-save chat state into the current history entry (debounced 1500ms inside the store).
  // persistAttachments runs async before the actual save.
  useEffect(() => {
    const currentId = useChatHistoryStore.getState().currentId;
    const snap: ChatHistorySnapshot = {
      systemMessage: slice.systemMessage,
      messages: slice.messages,
      params: slice.params,
      selectedConnectionId: slice.selectedConnectionId,
    };
    persistAttachments(currentId, snap)
      .then((serialisable) => {
        useChatHistoryStore.getState().scheduleAutoSave(serialisable);
      })
      .catch((e) => console.error("[ChatPage] persistAttachments failed", e));
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
      <ChatModeTabs />
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
          demoSeedKey="chat"
        />
      </div>
    </PlaygroundShell>
  );
}
