import i18n from "@/lib/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TtsTab } from "./TtsTab";
import { useAudioHistoryStore } from "./history";
import { useAudioStore } from "./store";

const renderTts = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <TtsTab />
    </I18nextProvider>,
  );

describe("TtsTab", () => {
  beforeEach(() => {
    useAudioStore.setState((s) => ({
      ...s,
      selectedConnectionId: null,
      tts: { ...s.tts, input: "", result: null, error: null, sending: false },
    }));
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Send button is disabled when input is empty", () => {
    useAudioStore.setState((s) => ({ ...s, selectedConnectionId: "c1" }));
    renderTts();
    expect(screen.getByRole("button", { name: /generate|send/i })).toBeDisabled();
  });

  it("posts to /api/playground/audio/tts with connectionId in body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, audioBase64: "aGVsbG8=", format: "mp3", latencyMs: 50 }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    useAudioStore.setState((s) => ({ ...s, selectedConnectionId: "c1" }));
    renderTts();
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "hello");
    await userEvent.click(screen.getByRole("button", { name: /generate|send/i }));
    await waitFor(() => {
      expect(useAudioStore.getState().tts.result).toEqual({
        audioBase64: "aGVsbG8=",
        format: "mp3",
      });
    });
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/playground/audio/tts");
    const body = JSON.parse(init.body as string);
    expect(body.connectionId).toBe("c1");
    expect(body.input).toBe("hello");
    expect(body.voice).toBe("alloy");
    // Plaintext credentials must never appear in request body.
    expect(body).not.toHaveProperty("apiKey");
    expect(body).not.toHaveProperty("apiBaseUrl");
  });

  it("renders <audio> after a successful generation", async () => {
    useAudioStore.getState().setTtsResult({ audioBase64: "aGVsbG8=", format: "mp3" });
    const { container } = renderTts();
    expect(container.querySelector("audio")?.getAttribute("src")).toBe(
      "data:audio/mp3;base64,aGVsbG8=",
    );
  });

  it("persists TTS result as a Blob in IDB via putBlob on success", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, audioBase64: "aGVsbG8=", format: "mp3", latencyMs: 50 }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const putBlobSpy = vi
      .spyOn(useAudioHistoryStore.getState(), "putBlob")
      .mockResolvedValue(undefined);
    const expectedId = useAudioHistoryStore.getState().currentId;
    useAudioStore.setState((s) => ({ ...s, selectedConnectionId: "c1" }));
    renderTts();
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "hello");
    await userEvent.click(screen.getByRole("button", { name: /generate|send/i }));
    await waitFor(() => {
      expect(useAudioStore.getState().tts.result).not.toBeNull();
    });
    await waitFor(() => {
      expect(putBlobSpy).toHaveBeenCalledWith(expectedId, "tts_result", expect.any(Blob));
    });
    const blobArg = putBlobSpy.mock.calls[0][2] as Blob;
    expect(blobArg.type).toBe("audio/mp3");
    putBlobSpy.mockRestore();
  });

  it("includes reference_audio_base64 and reference_text in TTS request body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, audioBase64: "aGVsbG8=", format: "mp3", latencyMs: 50 }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    useAudioStore.setState((s) => ({
      ...s,
      selectedConnectionId: "c1",
      tts: {
        ...s.tts,
        referenceAudioBase64: "data:audio/wav;base64,UklGRgAAAA==",
        referenceAudioFilename: "ref.wav",
        referenceText: "hello transcript",
      },
    }));
    renderTts();
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "hello");
    await userEvent.click(screen.getByRole("button", { name: /generate|send/i }));
    await waitFor(() => {
      expect(useAudioStore.getState().tts.result).not.toBeNull();
    });
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.reference_audio_base64).toBe("data:audio/wav;base64,UklGRgAAAA==");
    expect(body.reference_text).toBe("hello transcript");
  });
});
