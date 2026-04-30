import { PageHeader } from "@/components/common/page-header";
import { ApiError, api } from "@/lib/api-client";
import { base64ToBlob, blobToDataUrl, dataUrlToBlob } from "@/lib/dataUrl";
import { playgroundFetchStream } from "@/lib/playground-stream";
import { useConnectionsStore } from "@/stores/connections-store";
import type {
  ChatMessage,
  ChatMessageContentPart,
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
import { ChatParams } from "./ChatParams";
import { MessageComposer } from "./MessageComposer";
import { MessageList } from "./MessageList";
import { type AttachedFile, buildContentParts } from "./attachments";
import { type ChatHistorySnapshot, useChatHistoryStore } from "./history";
import { useChatStore } from "./store";

/** Sentinel prefix used to replace inline binary data in saved snapshots. */
const IDB_PREFIX = "idb://";

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
  const out = structuredClone(snap);
  const store = useChatHistoryStore.getState();

  for (let i = 0; i < out.messages.length; i++) {
    const m = out.messages[i];
    if (typeof m.content === "string") continue;

    const promises: Array<Promise<{ j: number; part: ChatMessageContentPart }>> = [];

    for (let j = 0; j < m.content.length; j++) {
      const p = m.content[j];
      const key = `msg${i}.part${j}`;

      if (p.type === "image_url" && p.image_url.url.startsWith("data:")) {
        promises.push(
          (async () => {
            const blob = dataUrlToBlob(p.image_url.url);
            await store.putBlob(entryId, key, blob);
            return {
              j,
              part: { ...p, image_url: { url: `${IDB_PREFIX}${key}` } } as ChatMessageContentPart,
            };
          })(),
        );
      } else if (p.type === "input_audio" && p.input_audio.data && !p.input_audio.data.startsWith(IDB_PREFIX)) {
        promises.push(
          (async () => {
            const blob = base64ToBlob(p.input_audio.data, `audio/${p.input_audio.format}`);
            await store.putBlob(entryId, key, blob);
            return {
              j,
              part: { ...p, input_audio: { ...p.input_audio, data: `${IDB_PREFIX}${key}` } } as ChatMessageContentPart,
            };
          })(),
        );
      } else if (p.type === "input_file" && p.file.file_data.startsWith("data:")) {
        promises.push(
          (async () => {
            const blob = dataUrlToBlob(p.file.file_data);
            await store.putBlob(entryId, key, blob);
            return {
              j,
              part: { ...p, file: { ...p.file, file_data: `${IDB_PREFIX}${key}` } } as ChatMessageContentPart,
            };
          })(),
        );
      }
    }

    // Parallel writes — all blobs for this message go concurrently.
    const results = await Promise.all(promises);
    for (const { j, part } of results) {
      (out.messages[i].content as ChatMessageContentPart[])[j] = part;
    }
  }

  return out;
}

/**
 * Reverse `persistAttachments`: for every content-part field that begins with
 * `idb://`, fetch the Blob, convert back to data URL, and inject into the
 * current chat store state. Runs asynchronously after the sync restore call.
 */
export async function rehydrateChatBlobs(entryId: string, snap: ChatHistorySnapshot): Promise<void> {
  const store = useChatHistoryStore.getState();

  type Patch = { msgIdx: number; partIdx: number; field: "url" | "data" | "file_data"; value: string };
  const patches: Array<Promise<Patch | null>> = [];

  for (let i = 0; i < snap.messages.length; i++) {
    const m = snap.messages[i];
    if (typeof m.content === "string") continue;

    for (let j = 0; j < m.content.length; j++) {
      const p = m.content[j];
      const key = `msg${i}.part${j}`;

      if (p.type === "image_url" && p.image_url.url === `${IDB_PREFIX}${key}`) {
        patches.push(
          (async () => {
            const blob = await store.getBlob(entryId, key);
            if (!blob) return null;
            const dataUrl = await blobToDataUrl(blob);
            return { msgIdx: i, partIdx: j, field: "url" as const, value: dataUrl };
          })(),
        );
      } else if (p.type === "input_audio" && p.input_audio.data === `${IDB_PREFIX}${key}`) {
        patches.push(
          (async () => {
            const blob = await store.getBlob(entryId, key);
            if (!blob) return null;
            const dataUrl = await blobToDataUrl(blob);
            // Strip the `data:<mime>;base64,` header — input_audio.data is raw base64.
            const b64 = dataUrl.split(",", 2)[1] ?? "";
            return { msgIdx: i, partIdx: j, field: "data" as const, value: b64 };
          })(),
        );
      } else if (p.type === "input_file" && p.file.file_data === `${IDB_PREFIX}${key}`) {
        patches.push(
          (async () => {
            const blob = await store.getBlob(entryId, key);
            if (!blob) return null;
            const dataUrl = await blobToDataUrl(blob);
            return { msgIdx: i, partIdx: j, field: "file_data" as const, value: dataUrl };
          })(),
        );
      }
    }
  }

  const resolved = await Promise.all(patches);
  const applied = resolved.filter((p): p is Patch => p !== null);
  if (applied.length === 0) return;

  // Snapshot current non-message state before reset, then apply patches to messages.
  const chatState = useChatStore.getState();
  const systemMessage = chatState.systemMessage;
  const params = chatState.params;
  const selectedConnectionId = chatState.selectedConnectionId;
  const msgs = structuredClone(chatState.messages) as ChatMessage[];

  for (const { msgIdx, partIdx, field, value } of applied) {
    const m = msgs[msgIdx];
    if (!m || typeof m.content === "string") continue;
    const part = m.content[partIdx];
    if (!part) continue;

    if (field === "url" && part.type === "image_url") {
      part.image_url = { ...part.image_url, url: value };
    } else if (field === "data" && part.type === "input_audio") {
      part.input_audio = { ...part.input_audio, data: value };
    } else if (field === "file_data" && part.type === "input_file") {
      part.file = { ...part.file, file_data: value };
    }
  }

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
        />
      </div>
    </PlaygroundShell>
  );
}
