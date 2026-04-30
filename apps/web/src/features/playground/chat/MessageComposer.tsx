import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ImageIcon, Mic, Paperclip, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ALLOWED_FILE_MIMES,
  ATTACHMENT_LIMITS,
  type AttachedFile,
  MAX_FILE_BYTES,
  readFileAsAttachment,
} from "./attachments";

interface MessageComposerProps {
  systemMessage: string;
  onSystemMessageChange: (s: string) => void;
  onSend: (text: string, attachments: AttachedFile[]) => void;
  onStop: () => void;
  sending: boolean;
  streaming: boolean;
  disabled: boolean;
  disabledReason?: string;
  /** Override Send button label (Compare uses "Send to N"). */
  sendLabelOverride?: string;
}

export function MessageComposer({
  systemMessage,
  onSystemMessageChange,
  onSend,
  onStop,
  sending,
  streaming,
  disabled,
  disabledReason,
  sendLabelOverride,
}: MessageComposerProps) {
  const { t } = useTranslation("playground");
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePick = async (file: File | undefined, kind: AttachedFile["kind"]) => {
    if (!file) return;
    if (attachments.length >= ATTACHMENT_LIMITS.maxCount) {
      toast.error(
        t("chat.composer.errors.tooManyAttachments", { max: ATTACHMENT_LIMITS.maxCount }),
      );
      return;
    }
    if (kind === "file") {
      if (!ALLOWED_FILE_MIMES.has(file.type)) {
        toast.error(t("chat.attachments.file.unsupportedMime"));
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        toast.error(t("chat.attachments.file.tooLarge"));
        return;
      }
    } else {
      if (file.size > ATTACHMENT_LIMITS.maxSizeBytes) {
        toast.error(
          t("chat.composer.errors.attachmentTooLarge", {
            maxMb: Math.floor(ATTACHMENT_LIMITS.maxSizeBytes / 1024 / 1024),
          }),
        );
        return;
      }
    }
    try {
      const att = await readFileAsAttachment(file, kind);
      setAttachments((prev) => [...prev, att]);
    } catch (e) {
      toast.error(
        t("chat.composer.errors.attachmentRead", {
          message: e instanceof Error ? e.message : "unknown",
        }),
      );
    }
  };

  const removeAttachment = (idx: number) =>
    setAttachments((prev) => prev.filter((_, i) => i !== idx));

  const submit = () => {
    if (disabled || sending) return;
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    onSend(draft, attachments);
    setDraft("");
    setAttachments([]);
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

      {attachments.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((a, idx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: attachment chip list, ephemeral
            <div key={idx} className="flex items-center gap-1 rounded border bg-muted px-2 text-xs">
              {a.kind === "image" ? (
                <img src={a.dataUrl} alt="" className="h-8 w-8 rounded object-cover" />
              ) : a.kind === "audio" ? (
                <Mic className="h-4 w-4" />
              ) : (
                <Paperclip className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="max-w-[140px] truncate">{a.name}</span>
              <button
                type="button"
                onClick={() => removeAttachment(idx)}
                className="ml-1 text-muted-foreground hover:text-foreground"
                aria-label={t("chat.composer.attachments.remove")}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex gap-2">
        <Textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !streaming) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t("chat.composer.placeholder")}
          className="text-sm"
          disabled={disabled || sending}
        />
        <div className="flex flex-col gap-1">
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon"
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={disabled || sending}
              aria-label={t("chat.composer.attachments.image")}
            >
              <ImageIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              type="button"
              onClick={() => audioInputRef.current?.click()}
              disabled={disabled || sending}
              aria-label={t("chat.composer.attachments.audio")}
            >
              <Mic className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || sending}
              aria-label={t("chat.composer.attachments.file")}
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          </div>
          {streaming ? (
            <Button variant="destructive" onClick={onStop}>
              {t("chat.composer.stop")}
            </Button>
          ) : (
            <Button
              onClick={submit}
              disabled={disabled || sending || (!draft.trim() && attachments.length === 0)}
              title={disabled ? disabledReason : undefined}
            >
              {sendLabelOverride ??
                (sending ? t("chat.composer.sending") : t("chat.composer.send"))}
            </Button>
          )}
        </div>
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          handlePick(e.target.files?.[0], "image");
          e.target.value = "";
        }}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          handlePick(e.target.files?.[0], "audio");
          e.target.value = "";
        }}
      />
      {/* Must match ALLOWED_FILE_MIMES in attachments.ts and FILE_MIME_RE in @modeldoctor/contracts/src/playground.ts */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,text/plain,application/json,text/markdown,text/x-markdown"
        aria-label={t("chat.composer.attachments.file")}
        hidden
        onChange={(e) => {
          handlePick(e.target.files?.[0], "file");
          e.target.value = "";
        }}
      />

      {disabled && disabledReason ? (
        <output className="mt-1 block text-[11px] text-muted-foreground">{disabledReason}</output>
      ) : null}
    </div>
  );
}
