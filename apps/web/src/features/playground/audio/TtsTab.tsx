import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/api-client";
import { useConnectionsStore } from "@/stores/connections-store";
import type { PlaygroundTtsRequest, PlaygroundTtsResponse } from "@modeldoctor/contracts";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PromptComposer } from "../_shared/PromptComposer";
import { useAudioHistoryStore } from "./history";
import { useAudioStore } from "./store";

export function TtsTab() {
  const { t } = useTranslation("playground");
  const tts = useAudioStore((s) => s.tts);
  const selectedConnectionId = useAudioStore((s) => s.selectedConnectionId);
  const conn = useConnectionsStore((s) =>
    selectedConnectionId ? s.get(selectedConnectionId) : null,
  );
  const audioRef = useRef<HTMLAudioElement>(null);

  // autoPlay when result changes
  useEffect(() => {
    if (tts.autoPlay && tts.result && audioRef.current) {
      const p = audioRef.current.play?.();
      // play() returns a Promise in real browsers; jsdom returns undefined — guard both.
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          /* user-gesture autoplay block — silently ignore */
        });
      }
    }
  }, [tts.result, tts.autoPlay]);

  const canSend = !!conn && tts.input.trim().length > 0 && !tts.sending;

  const onSend = async () => {
    // Read everything fresh from the store to avoid stale-closure bugs.
    const fresh = useAudioStore.getState();
    const connNow = fresh.selectedConnectionId
      ? useConnectionsStore.getState().get(fresh.selectedConnectionId)
      : null;
    if (!connNow) return;

    const body: PlaygroundTtsRequest = {
      apiBaseUrl: connNow.apiBaseUrl,
      apiKey: connNow.apiKey,
      model: connNow.model,
      customHeaders: connNow.customHeaders || undefined,
      queryParams: connNow.queryParams || undefined,
      input: fresh.tts.input,
      voice: fresh.tts.voice,
      format: fresh.tts.format,
      speed: fresh.tts.speed,
      reference_audio_base64: fresh.tts.referenceAudioBase64,
      reference_text: fresh.tts.referenceText,
    };
    fresh.setTtsSending(true);
    fresh.setTtsError(null);
    try {
      const res = await api.post<PlaygroundTtsResponse>("/api/playground/audio/tts", body);
      if (res.success && res.audioBase64) {
        const format = res.format ?? fresh.tts.format;
        useAudioStore.getState().setTtsResult({ audioBase64: res.audioBase64, format });
        // Persist the audio blob to IDB for history replay
        const b64 = res.audioBase64.match(/^data:[^;]+;base64,(.*)$/)?.[1] ?? res.audioBase64;
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: `audio/${format}` });
        const entryId = useAudioHistoryStore.getState().currentId;
        useAudioHistoryStore
          .getState()
          .putBlob(entryId, "tts_result", blob)
          .catch((err) => {
            console.error("[TtsTab] Failed to persist audio blob:", err);
          });
      } else {
        const msg = res.error ?? "unknown";
        useAudioStore.getState().setTtsError(msg);
        toast.error(t("audio.tts.errors.send", { message: msg }));
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "network";
      useAudioStore.getState().setTtsError(msg);
      toast.error(t("audio.tts.errors.send", { message: msg }));
    } finally {
      useAudioStore.getState().setTtsSending(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
      <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-border bg-card p-6">
        {tts.result ? (
          // biome-ignore lint/a11y/useMediaCaption: synthetic audio output, no transcript
          <audio
            ref={audioRef}
            controls
            src={`data:audio/${tts.result.format};base64,${tts.result.audioBase64}`}
            className="w-full max-w-2xl"
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t("audio.tts.placeholder")}</p>
        )}
      </div>
      {tts.error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {tts.error}
        </div>
      ) : null}
      <div>
        <Label htmlFor="tts-input" className="mb-1 block text-xs">
          {t("audio.tts.inputLabel")}
        </Label>
        <PromptComposer
          inputId="tts-input"
          value={tts.input}
          onChange={(v) => useAudioStore.getState().patchTts({ input: v })}
          onSubmit={onSend}
          sendLabel={tts.sending ? t("audio.tts.sending") : t("audio.tts.send")}
          sendDisabled={!canSend}
          rows={3}
          placeholder={t("audio.tts.inputPlaceholder")}
          toolbar={
            <>
              <Switch
                checked={tts.autoPlay}
                onCheckedChange={(v) => useAudioStore.getState().patchTts({ autoPlay: !!v })}
              />
              <Label className="text-xs">{t("audio.tts.autoPlay")}</Label>
            </>
          }
        />
      </div>
    </div>
  );
}
