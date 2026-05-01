import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { playgroundFetchMultipart } from "@/lib/playground-multipart";
import type { PlaygroundTranscriptionsResponse } from "@modeldoctor/contracts";
import { Copy, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RecorderControls } from "./RecorderControls";
import { useAudioStore } from "./store";

export function SttTab() {
  const { t } = useTranslation("playground");
  const stt = useAudioStore((s) => s.stt);
  const selectedConnectionId = useAudioStore((s) => s.selectedConnectionId);
  const blobRef = useRef<Blob | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: blobRef.current is mutated outside React; we re-create the URL when the file meta (which IS in store state) changes
  const audioUrl = useMemo(
    () => (blobRef.current ? URL.createObjectURL(blobRef.current) : null),
    [stt.fileName, stt.fileSize],
  );

  useEffect(() => {
    return () => {
      if (audioUrl && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const adoptBlob = (blob: Blob, name: string) => {
    blobRef.current = blob;
    useAudioStore.getState().setSttFileMeta({
      name,
      size: blob.size,
      mimeType: blob.type || "audio/webm",
    });
  };

  const onPickFile = (file: File | undefined) => {
    if (!file) return;
    adoptBlob(file, file.name);
  };

  const onRecorded = (blob: Blob, mimeType: string) => {
    const ext = mimeType.split("/")[1]?.split(";")[0] ?? "webm";
    adoptBlob(blob, `recording-${Date.now()}.${ext}`);
  };

  const onClearFile = () => {
    blobRef.current = null;
    useAudioStore.getState().setSttFileMeta({ name: null, size: null, mimeType: null });
    useAudioStore.getState().setSttResult(null);
  };

  const canTranscribe = !!selectedConnectionId && !!blobRef.current && !stt.sending;

  const onTranscribe = async () => {
    // Re-read fresh state to avoid stale-closure (matches the de-stale pattern from chat / TtsTab).
    const fresh = useAudioStore.getState();
    const connectionId = fresh.selectedConnectionId;
    if (!connectionId || !blobRef.current) return;

    const form = new FormData();
    form.append("file", blobRef.current, fresh.stt.fileName ?? "audio.webm");
    form.append("connectionId", connectionId);
    if (fresh.stt.language) form.append("language", fresh.stt.language);
    form.append("task", fresh.stt.task);
    if (fresh.stt.prompt) form.append("prompt", fresh.stt.prompt);
    if (fresh.stt.temperature !== undefined)
      form.append("temperature", String(fresh.stt.temperature));

    fresh.setSttSending(true);
    fresh.setSttError(null);
    try {
      const res = await playgroundFetchMultipart<PlaygroundTranscriptionsResponse>({
        path: "/api/playground/audio/transcriptions",
        form,
      });
      if (res.success) {
        useAudioStore.getState().setSttResult(res.text ?? "");
      } else {
        const msg = res.error ?? "unknown";
        useAudioStore.getState().setSttError(msg);
        toast.error(t("audio.stt.errors.transcribe", { message: msg }));
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "network";
      useAudioStore.getState().setSttError(msg);
      toast.error(t("audio.stt.errors.transcribe", { message: msg }));
    } finally {
      useAudioStore.getState().setSttSending(false);
    }
  };

  const onCopy = async () => {
    if (!stt.result) return;
    await navigator.clipboard.writeText(stt.result);
    toast.success(t("audio.stt.copied"));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
      <div className="rounded-lg border border-border bg-card p-4">
        {stt.fileName ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm">{stt.fileName}</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClearFile}
                aria-label={t("audio.stt.clearFile")}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {blobRef.current && audioUrl ? (
              // biome-ignore lint/a11y/useMediaCaption: user-supplied recording playback
              <audio controls src={audioUrl} className="w-full" />
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-6">
            <p className="text-sm text-muted-foreground">{t("audio.stt.uploadPlaceholder")}</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                {t("audio.stt.upload")}
              </Button>
              <RecorderControls onComplete={onRecorded} />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              hidden
              onChange={(e) => {
                onPickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        )}
      </div>

      <Button onClick={onTranscribe} disabled={!canTranscribe}>
        {stt.sending ? t("audio.stt.transcribing") : t("audio.stt.transcribe")}
      </Button>

      {stt.error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {stt.error}
        </div>
      ) : null}

      {stt.result ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">
              {t("audio.stt.resultLabel")}
            </span>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" onClick={onCopy} aria-label={t("audio.stt.copy")}>
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => useAudioStore.getState().setSttResult(null)}
                aria-label={t("audio.stt.clearResult")}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <pre className="whitespace-pre-wrap text-sm">{stt.result}</pre>
        </div>
      ) : null}
    </div>
  );
}
