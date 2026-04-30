import { PageHeader } from "@/components/common/page-header";
import { useConnectionsStore } from "@/stores/connections-store";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { CategoryEndpointSelector } from "../CategoryEndpointSelector";
import { PlaygroundShell } from "../PlaygroundShell";
import { genAudioSnippets } from "../code-snippets/audio";
import { HistoryDrawer } from "../history/HistoryDrawer";
import type { HistoryEntry } from "../history/createHistoryStore";
import { SttParams } from "./SttParams";
import { SttTab } from "./SttTab";
import { TtsParams } from "./TtsParams";
import { TtsTab } from "./TtsTab";
import { type AudioHistorySnapshot, useAudioHistoryStore } from "./history";
import { type TtsFormat, useAudioStore } from "./store";

type Tab = "tts" | "stt";

/** Play button that lazily fetches the TTS result blob for a history entry. */
function TtsHistoryPlayButton({ entry }: { entry: HistoryEntry<AudioHistorySnapshot> }) {
  const { t } = useTranslation("playground");
  const [src, setSrc] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const urlRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: stable entry.id
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (urlRef.current) {
        URL.revokeObjectURL?.(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [entry.id]);

  const safePlay = (el: HTMLAudioElement | null) => {
    if (!el) return;
    const p = el.play?.();
    if (p && typeof p.catch === "function") p.catch(() => {});
  };

  const handlePlay = async (ev: React.MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (src && audioRef.current) {
      safePlay(audioRef.current);
      return;
    }
    const blob = await useAudioHistoryStore.getState().getBlob(entry.id, "tts_result");
    if (!blob) return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    setSrc(url);
    // play via a tiny timeout to let React commit the src attr
    timerRef.current = setTimeout(() => {
      safePlay(audioRef.current);
      timerRef.current = null;
    }, 0);
  };

  return (
    <span className="flex shrink-0 items-center gap-1">
      {/* biome-ignore lint/a11y/useMediaCaption: inline history replay */}
      {src && <audio ref={audioRef} src={src} className="hidden" />}
      <button
        type="button"
        aria-label={t("audio.tts.playHistoryEntry")}
        className="rounded-sm p-1 text-muted-foreground opacity-60 hover:bg-accent hover:text-accent-foreground hover:opacity-100"
        onClick={handlePlay}
        onPointerDown={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
        }}
        onPointerUp={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
        }}
      >
        ▶
      </button>
    </span>
  );
}

export function AudioPage() {
  const { t } = useTranslation("playground");
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "stt" ? "stt" : "tts";

  const slice = useAudioStore();
  const { tts, stt, selectedConnectionId } = slice;

  // History restore (mirrors ChatPage pattern)
  const restoreSnap = (snap: AudioHistorySnapshot) => {
    const s = useAudioStore.getState();
    s.resetTts();
    s.resetStt();
    s.setSelected(snap.selectedConnectionId);
    s.patchTts({ ...snap.tts, format: snap.tts.format as TtsFormat });
    s.patchStt({ ...snap.stt, fileName: snap.stt.fileName });
    if (snap.stt.resultText) s.setSttResult(snap.stt.resultText);
    if (snap.activeTab !== tab) {
      const next = new URLSearchParams(params);
      next.set("tab", snap.activeTab);
      setParams(next, { replace: true });
    }
  };

  /** Rehydrate the TTS audio player by loading the blob saved under sourceId. */
  const rehydrateTtsBlob = (sourceId: string, fallbackFormat: string) => {
    useAudioHistoryStore
      .getState()
      .getBlob(sourceId, "tts_result")
      .then((blob) => {
        if (!blob) return;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          // Match the success-path invariant: store raw base64, not a data URL.
          // TtsTab's <audio src> already prepends 'data:audio/<format>;base64,'.
          const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
          if (!m) return; // unrecognized blob, silently skip
          const [, mime, base64] = m;
          const fmt = mime.split("/")[1] ?? fallbackFormat;
          useAudioStore.getState().setTtsResult({ audioBase64: base64, format: fmt as TtsFormat });
        };
        reader.readAsDataURL(blob);
      })
      .catch((err) => console.error("[AudioPage] rehydrate blob failed", err));
  };

  const historyCurrentId = useAudioHistoryStore((h) => h.currentId);
  const historyRestoreVersion = useAudioHistoryStore((h) => h.restoreVersion);
  // biome-ignore lint/correctness/useExhaustiveDependencies: snap restore via id+version
  useEffect(() => {
    // restoreVersion === 0 means initial mount hydration — don't clobber the URL tab.
    if (historyRestoreVersion === 0) return;
    const entry = useAudioHistoryStore.getState().list.find((e) => e.id === historyCurrentId);
    if (entry) restoreSnap(entry.snapshot);
  }, [historyCurrentId, historyRestoreVersion]);

  // Auto-save
  useEffect(() => {
    useAudioHistoryStore.getState().scheduleAutoSave({
      selectedConnectionId,
      tts: {
        input: tts.input,
        voice: tts.voice,
        format: tts.format,
        speed: tts.speed,
        autoPlay: tts.autoPlay,
      },
      stt: {
        language: stt.language,
        task: stt.task,
        prompt: stt.prompt,
        temperature: stt.temperature,
        fileName: stt.fileName,
        resultText: stt.result,
      },
      activeTab: tab,
    });
  }, [
    selectedConnectionId,
    tab,
    tts.input,
    tts.voice,
    tts.format,
    tts.speed,
    tts.autoPlay,
    stt.language,
    stt.task,
    stt.prompt,
    stt.temperature,
    stt.fileName,
    stt.result,
  ]);

  const conn = useConnectionsStore((s) =>
    selectedConnectionId ? s.get(selectedConnectionId) : null,
  );
  const snippets = conn
    ? genAudioSnippets({
        activeTab: tab,
        apiBaseUrl: conn.apiBaseUrl,
        tts,
        stt,
      })
    : null;

  return (
    <PlaygroundShell
      category="audio"
      tabs={[
        { key: "tts", label: t("audio.tabs.tts") },
        { key: "stt", label: t("audio.tabs.stt") },
      ]}
      activeTab={tab}
      onTabChange={(k) => {
        const next = new URLSearchParams(params);
        next.set("tab", k);
        setParams(next, { replace: true });
      }}
      viewCodeSnippets={snippets}
      historySlot={
        <HistoryDrawer
          useHistoryStore={useAudioHistoryStore}
          renderRowExtras={(e) => <TtsHistoryPlayButton entry={e} />}
          onRestoreConfirm={(sourceEntry) =>
            rehydrateTtsBlob(sourceEntry.id, sourceEntry.snapshot.tts.format)
          }
        />
      }
      paramsSlot={
        <div className="space-y-4">
          <CategoryEndpointSelector
            category="audio"
            selectedConnectionId={selectedConnectionId}
            onSelect={(id) => useAudioStore.getState().setSelected(id)}
          />
          {tab === "tts" ? (
            <TtsParams value={tts} onChange={(p) => useAudioStore.getState().patchTts(p)} />
          ) : (
            <SttParams value={stt} onChange={(p) => useAudioStore.getState().patchStt(p)} />
          )}
        </div>
      }
    >
      <PageHeader title={t("audio.title")} subtitle={t("audio.subtitle")} />
      {tab === "tts" ? <TtsTab /> : <SttTab />}
    </PlaygroundShell>
  );
}
