import type { ChatMessage } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";

function renderContent(m: ChatMessage): string {
  if (typeof m.content === "string") return m.content;
  return m.content.map((p) => (p.type === "text" ? p.text : `[${p.type}]`)).join(" ");
}

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const { t } = useTranslation("playground");

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("chat.messages.empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-6 py-4">
      {messages.map((m, idx) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: append-only Phase 1; stable id is a Phase 2 concern
        <div key={idx} className="rounded-md border border-border bg-card p-3">
          <div className="mb-1 text-xs font-semibold text-muted-foreground">
            {t(`chat.messages.${m.role}`)}
          </div>
          <div className="whitespace-pre-wrap text-sm">{renderContent(m)}</div>
        </div>
      ))}
    </div>
  );
}
