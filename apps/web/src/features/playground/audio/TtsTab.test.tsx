import i18n from "@/lib/i18n";
import { useConnectionsStore } from "@/stores/connections-store";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TtsTab } from "./TtsTab";
import { useAudioStore } from "./store";

const renderTts = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <TtsTab />
    </I18nextProvider>,
  );

function seedConn() {
  useConnectionsStore.getState().create({
    name: "audio",
    apiBaseUrl: "http://x",
    apiKey: "k",
    model: "tts-1",
    customHeaders: "",
    queryParams: "",
    category: "audio",
    tags: [],
  });
}

describe("TtsTab", () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionsStore.setState({ connections: [] });
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
    seedConn();
    const conn = useConnectionsStore.getState().list()[0];
    useAudioStore.setState((s) => ({ ...s, selectedConnectionId: conn.id }));
    renderTts();
    expect(screen.getByRole("button", { name: /generate|send/i })).toBeDisabled();
  });

  it("posts to /api/playground/audio/tts and stores result", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, audioBase64: "aGVsbG8=", format: "mp3", latencyMs: 50 }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    seedConn();
    const conn = useConnectionsStore.getState().list()[0];
    useAudioStore.setState((s) => ({ ...s, selectedConnectionId: conn.id }));
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
    expect(body.input).toBe("hello");
    expect(body.voice).toBe("alloy");
  });

  it("renders <audio> after a successful generation", async () => {
    useAudioStore.getState().setTtsResult({ audioBase64: "aGVsbG8=", format: "mp3" });
    const { container } = renderTts();
    expect(container.querySelector("audio")?.getAttribute("src")).toBe(
      "data:audio/mp3;base64,aGVsbG8=",
    );
  });

  it("includes reference_audio_base64 and reference_text in TTS request body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, audioBase64: "aGVsbG8=", format: "mp3", latencyMs: 50 }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    seedConn();
    const conn = useConnectionsStore.getState().list()[0];
    useAudioStore.setState((s) => ({
      ...s,
      selectedConnectionId: conn.id,
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
