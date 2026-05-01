import { beforeEach, describe, expect, it } from "vitest";
import { useAudioStore } from "./store";

describe("useAudioStore", () => {
  beforeEach(() => {
    useAudioStore.getState().resetTts();
    useAudioStore.getState().resetStt();
    useAudioStore.getState().setSelected(null);
  });

  it("starts with sane defaults", () => {
    const s = useAudioStore.getState();
    expect(s.selectedConnectionId).toBeNull();
    expect(s.tts.voice).toBe("alloy");
    expect(s.tts.format).toBe("mp3");
    expect(s.tts.autoPlay).toBe(true);
    expect(s.tts.result).toBeNull();
    expect(s.stt.task).toBe("transcribe");
    expect(s.stt.result).toBeNull();
  });

  it("patchTts merges and patchStt merges", () => {
    useAudioStore.getState().patchTts({ input: "hello", voice: "echo" });
    const tts = useAudioStore.getState().tts;
    expect(tts.input).toBe("hello");
    expect(tts.voice).toBe("echo");
    expect(tts.format).toBe("mp3");

    useAudioStore.getState().patchStt({ language: "zh", task: "translate" });
    const stt = useAudioStore.getState().stt;
    expect(stt.language).toBe("zh");
    expect(stt.task).toBe("translate");
  });

  it("setTtsResult / setSttResult populate result fields", () => {
    useAudioStore.getState().setTtsResult({ audioBase64: "abc", format: "wav" });
    expect(useAudioStore.getState().tts.result).toEqual({ audioBase64: "abc", format: "wav" });

    useAudioStore.getState().setSttResult("hello world");
    expect(useAudioStore.getState().stt.result).toBe("hello world");
  });

  it("setSttFileMeta records filename / size / mimeType", () => {
    useAudioStore
      .getState()
      .setSttFileMeta({ name: "rec.webm", size: 1234, mimeType: "audio/webm" });
    const stt = useAudioStore.getState().stt;
    expect(stt.fileName).toBe("rec.webm");
    expect(stt.fileSize).toBe(1234);
    expect(stt.fileMimeType).toBe("audio/webm");
  });

  it("resetTts clears tts but leaves selectedConnectionId + stt alone", () => {
    useAudioStore.getState().setSelected("conn-1");
    useAudioStore.getState().patchTts({ input: "stuff" });
    useAudioStore.getState().patchStt({ prompt: "stt-stuff" });
    useAudioStore.getState().resetTts();
    expect(useAudioStore.getState().selectedConnectionId).toBe("conn-1");
    expect(useAudioStore.getState().tts.input).toBe("");
    expect(useAudioStore.getState().stt.prompt).toBe("stt-stuff");
  });
});
