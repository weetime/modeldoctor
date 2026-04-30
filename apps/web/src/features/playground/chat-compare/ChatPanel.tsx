import { Button } from "@/components/ui/button";
import { Settings2, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CategoryEndpointSelector } from "../CategoryEndpointSelector";
import { ChatParams } from "../chat/ChatParams";
import { MessageList } from "../chat/MessageList";
import { useCompareStore } from "./store";

interface ChatPanelProps {
  index: number;
}

export function ChatPanel({ index }: ChatPanelProps) {
  const { t } = useTranslation("playground");
  const panel = useCompareStore((s) => s.panels[index]);

  if (!panel) return null;

  return (
    <div className="flex min-h-0 flex-col rounded-md border border-border bg-card">
      <div className="flex items-center gap-1 border-b border-border p-2">
        <div className="flex-1">
          <CategoryEndpointSelector
            category="chat"
            selectedConnectionId={panel.selectedConnectionId}
            onSelect={(id) => useCompareStore.getState().setPanelConnection(index, id)}
          />
        </div>
        <Button
          variant="ghost" size="icon"
          aria-label={t("chat.compare.clear")}
          onClick={() => useCompareStore.getState().clearPanelMessages(index)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <details className="border-b border-border">
        <summary className="flex cursor-pointer items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
          <Settings2 className="h-3 w-3" />
          {t("chat.compare.params")}
        </summary>
        <div className="p-2">
          <ChatParams
            value={panel.params}
            onChange={(p) => useCompareStore.getState().patchPanelParams(index, p)}
          />
        </div>
      </details>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <MessageList messages={panel.messages} />
        {panel.error ? (
          <div className="m-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {panel.error}
          </div>
        ) : null}
      </div>
      {panel.streaming ? (
        <div className="border-t border-border p-2">
          <Button
            variant="destructive" size="sm"
            onClick={() => panel.abortController?.abort()}
          >
            <Square className="mr-1 h-4 w-4" />
            {t("chat.compare.stop")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
