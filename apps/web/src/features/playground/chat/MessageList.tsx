import type { ChatMessage, ChatMessageContentPart } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";

function renderPart(p: ChatMessageContentPart, idx: number) {
  if (p.type === "text") {
    return (
      <div key={idx} className="whitespace-pre-wrap text-sm">
        {p.text}
      </div>
    );
  }
  if (p.type === "image_url") {
    return (
      <img
        key={idx}
        src={p.image_url.url}
        alt=""
        className="max-h-64 max-w-full rounded border border-border"
      />
    );
  }
  if (p.type === "input_audio") {
    return (
      // biome-ignore lint/a11y/useMediaCaption: user-supplied attachment, no transcript available
      <audio
        key={idx}
        controls
        src={`data:audio/${p.input_audio.format};base64,${p.input_audio.data}`}
        className="w-full"
      />
    );
  }
  return null;
}

function renderContent(m: ChatMessage) {
  if (typeof m.content === "string") {
    return <div className="whitespace-pre-wrap text-sm">{m.content}</div>;
  }
  return <div className="flex flex-col gap-2">{m.content.map((p, i) => renderPart(p, i))}</div>;
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
        // biome-ignore lint/suspicious/noArrayIndexKey: append-only chat list
        <div key={idx} className="rounded-md border border-border bg-card p-3">
          <div className="mb-1 text-xs font-semibold text-muted-foreground">
            {t(`chat.messages.${m.role}`)}
          </div>
          {renderContent(m)}
        </div>
      ))}
    </div>
  );
}
