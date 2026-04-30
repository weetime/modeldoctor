import i18n from "@/lib/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioPage } from "./AudioPage";
import { useAudioHistoryStore } from "./history";
import { useAudioStore } from "./store";

// Render TtsTab's <audio> element so we can assert on its src after rehydration.
vi.mock("./TtsTab", () => ({
  TtsTab: () => {
    const tts = useAudioStore((s) => s.tts);
    return tts.result ? (
      // biome-ignore lint/a11y/useMediaCaption: test stub
      <audio
        data-testid="tts-audio"
        src={`data:audio/${tts.result.format};base64,${tts.result.audioBase64}`}
      />
    ) : (
      <div data-testid="tts-tab" />
    );
  },
}));
vi.mock("./SttTab", () => ({ SttTab: () => <div data-testid="stt-tab" /> }));

const renderAt = (initialEntry: string) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/playground/audio" element={<AudioPage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );

describe("AudioPage", () => {
  it("defaults to TTS tab when no ?tab=", () => {
    renderAt("/playground/audio");
    expect(screen.getByTestId("tts-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("stt-tab")).not.toBeInTheDocument();
  });

  it("renders STT tab when ?tab=stt", () => {
    renderAt("/playground/audio?tab=stt");
    expect(screen.getByTestId("stt-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("tts-tab")).not.toBeInTheDocument();
  });
});

describe("AudioPage – TTS history play button", () => {
  beforeEach(() => {
    useAudioHistoryStore.getState().reset();
    useAudioStore.setState((s) => ({
      ...s,
      selectedConnectionId: null,
      tts: { ...s.tts, result: null, error: null },
    }));
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:fake-url"),
      revokeObjectURL: vi.fn(),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("history row renders a play button when a blob exists for the entry", async () => {
    const user = userEvent.setup();
    // Seed an old entry with a preview
    useAudioHistoryStore.getState().save({
      selectedConnectionId: null,
      tts: { input: "hello world", voice: "alloy", format: "mp3", autoPlay: true },
      stt: { language: "", task: "transcribe", prompt: "", fileName: null, resultText: null },
      activeTab: "tts",
    });
    const oldId = useAudioHistoryStore.getState().currentId;
    useAudioHistoryStore.getState().newSession();

    // Mock getBlob to return a blob for the old entry
    const fakeBlob = new Blob(["fake-audio"], { type: "audio/mp3" });
    const getBlobSpy = vi
      .spyOn(useAudioHistoryStore.getState(), "getBlob")
      .mockImplementation(async (entryId, key) => {
        if (entryId === oldId && key === "tts_result") return fakeBlob;
        return null;
      });

    renderAt("/playground/audio");
    // Open the history drawer
    await user.click(screen.getByRole("button", { name: /history|历史/i }));
    // The old entry row should have a play button
    const playBtn = await screen.findByRole("button", { name: /play recorded audio|播放录音/i });
    expect(playBtn).toBeInTheDocument();

    // Click play — should call getBlob then createObjectURL
    await user.click(playBtn);
    await waitFor(() => {
      expect(getBlobSpy).toHaveBeenCalledWith(oldId, "tts_result");
    });
    await waitFor(() => {
      expect(URL.createObjectURL).toHaveBeenCalledWith(fakeBlob);
    });

    getBlobSpy.mockRestore();
  });

  it("restoring a history entry with a TTS blob rehydrates the audio player", async () => {
    const user = userEvent.setup();
    // Seed an old entry
    useAudioHistoryStore.getState().save({
      selectedConnectionId: null,
      tts: { input: "rehydrate me", voice: "alloy", format: "mp3", autoPlay: true },
      stt: { language: "", task: "transcribe", prompt: "", fileName: null, resultText: null },
      activeTab: "tts",
    });
    const oldId = useAudioHistoryStore.getState().currentId;
    useAudioHistoryStore.getState().newSession();

    const fakeBlob = new Blob(["fake-audio-bytes"], { type: "audio/mp3" });
    const getBlobSpy = vi
      .spyOn(useAudioHistoryStore.getState(), "getBlob")
      .mockImplementation(async (entryId, key) => {
        if (entryId === oldId && key === "tts_result") return fakeBlob;
        return null;
      });

    // Track setTtsResult calls
    const setResultSpy = vi.spyOn(useAudioStore.getState(), "setTtsResult");

    renderAt("/playground/audio");
    // Open history drawer
    await user.click(screen.getByRole("button", { name: /history|历史/i }));
    // Click on the old entry to open the restore dialog (preview is "🔊 rehydrate me")
    await user.click(await screen.findByText(/rehydrate me/));
    // Confirm restore
    await user.click(await screen.findByRole("button", { name: /^restore$|^恢复$/i }));

    // After restore, getBlob should be called for rehydration
    await waitFor(() => {
      expect(getBlobSpy).toHaveBeenCalledWith(oldId, "tts_result");
    });

    // setTtsResult must be called with RAW base64 (no data: prefix) and the correct format.
    await waitFor(() => {
      expect(setResultSpy).toHaveBeenCalled();
    });
    const callArg = setResultSpy.mock.calls[0][0] as { audioBase64: string; format: string };
    // Invariant: audioBase64 must NOT start with "data:" — TtsTab prepends the header itself.
    expect(callArg.audioBase64).not.toMatch(/^data:/);
    // format must be set from the blob MIME type
    expect(callArg.format).toBe("mp3");

    // The rendered <audio src> must be a well-formed single data URL.
    const audioEl = await screen.findByTestId("tts-audio");
    expect(audioEl.getAttribute("src")).toMatch(/^data:audio\/[^;]+;base64,[A-Za-z0-9+/=]+$/);

    getBlobSpy.mockRestore();
    setResultSpy.mockRestore();
  });

  it("cancels pending play timer on unmount before the tick fires", async () => {
    const user = userEvent.setup();

    // Seed a history entry so a play button appears in the drawer.
    useAudioHistoryStore.getState().save({
      selectedConnectionId: null,
      tts: { input: "timer leak test", voice: "alloy", format: "mp3", autoPlay: false },
      stt: { language: "", task: "transcribe", prompt: "", fileName: null, resultText: null },
      activeTab: "tts",
    });
    useAudioHistoryStore.getState().newSession();

    const fakeBlob = new Blob(["x"], { type: "audio/mp3" });
    const getBlobSpy = vi
      .spyOn(useAudioHistoryStore.getState(), "getBlob")
      .mockResolvedValue(fakeBlob);

    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    const { unmount } = renderAt("/playground/audio");

    // Open the history drawer and click play.
    await user.click(screen.getByRole("button", { name: /history|历史/i }));
    const playBtn = await screen.findByRole("button", { name: /play recorded audio|播放录音/i });
    await user.click(playBtn);

    // Wait for getBlob to resolve (the setTimeout gets scheduled here).
    await waitFor(() => expect(getBlobSpy).toHaveBeenCalled());

    // Unmount — the useEffect cleanup must call clearTimeout on the pending timer.
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
    getBlobSpy.mockRestore();
  });
});
