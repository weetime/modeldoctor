import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface MessageComposerProps {
  systemMessage: string;
  onSystemMessageChange: (s: string) => void;
  onSend: (text: string) => void;
  sending: boolean;
  disabled: boolean;
  disabledReason?: string;
}

export function MessageComposer({
  systemMessage,
  onSystemMessageChange,
  onSend,
  sending,
  disabled,
  disabledReason,
}: MessageComposerProps) {
  const { t } = useTranslation("playground");
  const [draft, setDraft] = useState("");

  const submit = () => {
    if (disabled || sending) return;
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  return (
    <div className="border-t border-border bg-card px-6 py-3">
      <details className="mb-2">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          {t("chat.system.label")}
        </summary>
        <Textarea
          rows={2}
          value={systemMessage}
          onChange={(e) => onSystemMessageChange(e.target.value)}
          placeholder={t("chat.system.placeholder")}
          className="mt-2 font-mono text-xs"
        />
      </details>
      <div className="flex gap-2">
        <Textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t("chat.composer.placeholder")}
          className="text-sm"
          disabled={disabled || sending}
        />
        <Button
          onClick={submit}
          disabled={disabled || sending || !draft.trim()}
          title={disabled ? disabledReason : undefined}
        >
          {sending ? t("chat.composer.sending") : t("chat.composer.send")}
        </Button>
      </div>
      {disabled && disabledReason ? (
        <output className="mt-1 block text-[11px] text-muted-foreground">{disabledReason}</output>
      ) : null}
    </div>
  );
}
