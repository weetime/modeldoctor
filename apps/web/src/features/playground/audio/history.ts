import { createHistoryStore } from "../history/createHistoryStore";

export interface AudioHistorySnapshot {
  selectedConnectionId: string | null;
  tts: { input: string; voice: string; format: string; speed?: number; autoPlay: boolean };
  stt: {
    language: string;
    task: "transcribe" | "translate";
    prompt: string;
    temperature?: number;
    fileName: string | null;
    resultText: string | null;
  };
  activeTab: "tts" | "stt";
}

export const useAudioHistoryStore = createHistoryStore<AudioHistorySnapshot>({
  name: "md-playground-history-audio",
  blank: () => ({
    selectedConnectionId: null,
    tts: { input: "", voice: "alloy", format: "mp3", autoPlay: true },
    stt: {
      language: "", task: "transcribe", prompt: "",
      fileName: null, resultText: null,
    },
    activeTab: "tts",
  }),
  preview: (s) => {
    if (s.tts.input.trim()) return `🔊 ${s.tts.input.slice(0, 80)}`;
    if (s.stt.resultText) return `🎤 ${s.stt.resultText.slice(0, 80)}`;
    if (s.stt.fileName) return `📎 ${s.stt.fileName}`;
    return "";
  },
});
