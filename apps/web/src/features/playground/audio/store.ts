import { create } from "zustand";

export type TtsFormat = "mp3" | "wav" | "flac" | "opus" | "aac" | "pcm";

export interface TtsSlice {
  input: string;
  voice: string;
  format: TtsFormat;
  speed: number | undefined;
  autoPlay: boolean;
  result: { audioBase64: string; format: string } | null;
  sending: boolean;
  error: string | null;
}

export interface SttSlice {
  fileName: string | null;
  fileSize: number | null;
  fileMimeType: string | null;
  language: string;
  task: "transcribe" | "translate";
  prompt: string;
  temperature: number | undefined;
  result: string | null;
  sending: boolean;
  error: string | null;
}

export interface AudioStoreState {
  selectedConnectionId: string | null;
  tts: TtsSlice;
  stt: SttSlice;

  setSelected: (id: string | null) => void;
  patchTts: (p: Partial<TtsSlice>) => void;
  patchStt: (p: Partial<SttSlice>) => void;
  setTtsResult: (r: { audioBase64: string; format: string } | null) => void;
  setSttResult: (text: string | null) => void;
  setSttFileMeta: (meta: { name: string | null; size: number | null; mimeType: string | null }) => void;
  setTtsSending: (b: boolean) => void;
  setSttSending: (b: boolean) => void;
  setTtsError: (e: string | null) => void;
  setSttError: (e: string | null) => void;
  resetTts: () => void;
  resetStt: () => void;
}

const initialTts: TtsSlice = {
  input: "",
  voice: "alloy",
  format: "mp3",
  speed: undefined,
  autoPlay: true,
  result: null,
  sending: false,
  error: null,
};

const initialStt: SttSlice = {
  fileName: null,
  fileSize: null,
  fileMimeType: null,
  language: "",
  task: "transcribe",
  prompt: "",
  temperature: undefined,
  result: null,
  sending: false,
  error: null,
};

export const useAudioStore = create<AudioStoreState>((set) => ({
  selectedConnectionId: null,
  tts: { ...initialTts },
  stt: { ...initialStt },

  setSelected: (id) => set({ selectedConnectionId: id }),
  patchTts: (p) => set((s) => ({ tts: { ...s.tts, ...p } })),
  patchStt: (p) => set((s) => ({ stt: { ...s.stt, ...p } })),
  setTtsResult: (r) => set((s) => ({ tts: { ...s.tts, result: r } })),
  setSttResult: (text) => set((s) => ({ stt: { ...s.stt, result: text } })),
  setSttFileMeta: ({ name, size, mimeType }) =>
    set((s) => ({ stt: { ...s.stt, fileName: name, fileSize: size, fileMimeType: mimeType } })),
  setTtsSending: (b) => set((s) => ({ tts: { ...s.tts, sending: b } })),
  setSttSending: (b) => set((s) => ({ stt: { ...s.stt, sending: b } })),
  setTtsError: (e) => set((s) => ({ tts: { ...s.tts, error: e } })),
  setSttError: (e) => set((s) => ({ stt: { ...s.stt, error: e } })),
  resetTts: () => set((s) => ({ tts: { ...initialTts }, selectedConnectionId: s.selectedConnectionId })),
  resetStt: () => set((s) => ({ stt: { ...initialStt }, selectedConnectionId: s.selectedConnectionId })),
}));
