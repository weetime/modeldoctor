import { PageHeader } from "@/components/common/page-header";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { CategoryEndpointSelector } from "../CategoryEndpointSelector";
import { PlaygroundShell } from "../PlaygroundShell";
import { HistoryDrawer } from "../history/HistoryDrawer";
import { SttParams } from "./SttParams";
import { SttTab } from "./SttTab";
import { TtsParams } from "./TtsParams";
import { TtsTab } from "./TtsTab";
import { type AudioHistorySnapshot, useAudioHistoryStore } from "./history";
import { type TtsFormat, useAudioStore } from "./store";
import { genAudioSnippets } from "../code-snippets/audio";
import { useConnectionsStore } from "@/stores/connections-store";

type Tab = "tts" | "stt";

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

  const historyCurrentId = useAudioHistoryStore((h) => h.currentId);
  const historyRestoreVersion = useAudioHistoryStore((h) => h.restoreVersion);
  // biome-ignore lint/correctness/useExhaustiveDependencies: snap restore via id+version
  useEffect(() => {
    // restoreVersion === 0 means initial mount hydration — don't clobber the URL tab.
    if (historyRestoreVersion === 0) return;
    const snap = useAudioHistoryStore.getState().list.find((e) => e.id === historyCurrentId);
    if (snap) restoreSnap(snap.snapshot);
  }, [historyCurrentId, historyRestoreVersion]);

  // Auto-save
  useEffect(() => {
    useAudioHistoryStore.getState().scheduleAutoSave({
      selectedConnectionId,
      tts: {
        input: tts.input, voice: tts.voice, format: tts.format,
        speed: tts.speed, autoPlay: tts.autoPlay,
      },
      stt: {
        language: stt.language, task: stt.task, prompt: stt.prompt,
        temperature: stt.temperature, fileName: stt.fileName,
        resultText: stt.result,
      },
      activeTab: tab,
    });
  }, [
    selectedConnectionId, tab,
    tts.input, tts.voice, tts.format, tts.speed, tts.autoPlay,
    stt.language, stt.task, stt.prompt, stt.temperature, stt.fileName, stt.result,
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
      historySlot={<HistoryDrawer useHistoryStore={useAudioHistoryStore} />}
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
