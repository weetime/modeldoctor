import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api-client";
import { playgroundFetchStream } from "@/lib/playground-stream";
import { useConnectionsStore } from "@/stores/connections-store";
import type {
  ChatMessage, PlaygroundChatRequest, PlaygroundChatResponse,
} from "@modeldoctor/contracts";
import { Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PlaygroundShell } from "../PlaygroundShell";
import { type AttachedFile, buildContentParts } from "../chat/attachments";
import { MessageComposer } from "../chat/MessageComposer";
import { useChatModeTabs } from "./useChatModeTabs";
import { ChatPanel } from "./ChatPanel";
import { CompareHistoryControls } from "./CompareHistory";
import { PanelCountSwitcher } from "./PanelCountSwitcher";
import { useCompareStore } from "./store";

export function ChatComparePage() {
  const { t } = useTranslation("playground");
  const chatModeTabs = useChatModeTabs();
  const panelCount = useCompareStore((s) => s.panelCount);
  const panels = useCompareStore((s) => s.panels);
  const sharedSystemMessage = useCompareStore((s) => s.sharedSystemMessage);
  const anyStreaming = panels.some((p) => p.streaming);

  const onSend = (text: string, attachments: AttachedFile[]) => {
    const compare = useCompareStore.getState();
    const content = buildContentParts(text, attachments);
    const userMsg: ChatMessage = { role: "user", content };

    compare.panels.forEach((panel, i) => {
      const conn = panel.selectedConnectionId
        ? useConnectionsStore.getState().get(panel.selectedConnectionId)
        : null;
      if (!conn) {
        compare.setPanelError(i, t("chat.compare.errors.noConnection"));
        return;
      }
      compare.setPanelError(i, null);
      compare.appendMessageToPanel(i, userMsg);
      compare.setPanelSending(i, true);

      const messagesForRequest: ChatMessage[] = [
        ...(compare.sharedSystemMessage.trim()
          ? [{ role: "system" as const, content: compare.sharedSystemMessage.trim() }]
          : []),
        ...useCompareStore.getState().panels[i].messages,
      ];

      const body: PlaygroundChatRequest = {
        apiBaseUrl: conn.apiBaseUrl,
        apiKey: conn.apiKey,
        model: conn.model,
        customHeaders: conn.customHeaders || undefined,
        queryParams: conn.queryParams || undefined,
        messages: messagesForRequest,
        params: panel.params,
      };

      if (panel.params.stream) {
        const ac = new AbortController();
        compare.setPanelStreaming(i, true);
        compare.setPanelAbortController(i, ac);
        playgroundFetchStream({
          path: "/api/playground/chat",
          body,
          signal: ac.signal,
          onSseEvent: (data) => {
            if (data === "[DONE]") return;
            try {
              const evt = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
              const tok = evt.choices?.[0]?.delta?.content;
              if (tok) useCompareStore.getState().appendAssistantTokenToPanel(i, tok);
            } catch {/* non-JSON SSE comment */}
          },
        })
          .catch((e) => {
            if (!(e instanceof DOMException && e.name === "AbortError")) {
              compare.setPanelError(i, e instanceof Error ? e.message : "stream failed");
              toast.error(t("chat.errors.send", { message: e instanceof Error ? e.message : "stream failed" }));
            }
          })
          .finally(() => {
            const s = useCompareStore.getState();
            s.setPanelStreaming(i, false);
            s.setPanelAbortController(i, null);
            s.setPanelSending(i, false);
          });
      } else {
        api.post<PlaygroundChatResponse>("/api/playground/chat", body)
          .then((res) => {
            if (res.success) {
              compare.appendMessageToPanel(i, { role: "assistant", content: res.content ?? "" });
            } else {
              compare.setPanelError(i, res.error ?? "unknown");
            }
          })
          .catch((e) => {
            compare.setPanelError(i, e instanceof ApiError ? e.message : "network");
          })
          .finally(() => compare.setPanelSending(i, false));
      }
    });
  };

  const onStopAll = () => useCompareStore.getState().abortAll();

  const activePanels = panels.slice(0, panelCount);
  const allDisconnected = activePanels.every((p) => !p.selectedConnectionId);
  const anyInFlight = activePanels.some((p) => p.sending || p.streaming);

  return (
    <PlaygroundShell
      category="chat"
      title={t("chat.compare.title")}
      subtitle={t("chat.compare.subtitle")}
      tabs={chatModeTabs.tabs}
      activeTab={chatModeTabs.active}
      onTabChange={chatModeTabs.onChange}
      paramsSlot={null}
      rightPanelDefaultOpen={false}
      historySlot={<CompareHistoryControls />}
      toolbarRightSlot={<PanelCountSwitcher />}
    >
      <div className="px-6 pb-3">
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            {t("chat.system.label")}
          </summary>
          <Textarea
            rows={2}
            value={sharedSystemMessage}
            onChange={(e) => useCompareStore.getState().setSharedSystemMessage(e.target.value)}
            placeholder={t("chat.system.placeholder")}
            className="mt-2 font-mono text-xs"
          />
        </details>
      </div>
      <div
        className="grid min-h-0 flex-1 gap-3 overflow-x-auto px-6"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))" }}
      >
        {panels.map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: index is panel identity in this store
          <ChatPanel key={i} index={i} />
        ))}
      </div>
      <div className="border-t border-border">
        <MessageComposer
          systemMessage={sharedSystemMessage}
          onSystemMessageChange={(s) => useCompareStore.getState().setSharedSystemMessage(s)}
          onSend={onSend}
          onStop={() => {/* per-panel stop is in the panel itself */}}
          sending={anyInFlight}
          streaming={false}
          disabled={allDisconnected}
          disabledReason={allDisconnected ? t("chat.compare.errors.allDisconnected") : undefined}
          sendLabelOverride={t("chat.compare.sendN", { count: panelCount })}
        />
        {anyStreaming ? (
          <div className="px-6 pb-3">
            <Button variant="destructive" size="sm" onClick={onStopAll}>
              <Square className="mr-1 h-4 w-4" />
              {t("chat.compare.stopAll")}
            </Button>
          </div>
        ) : null}
      </div>
    </PlaygroundShell>
  );
}
