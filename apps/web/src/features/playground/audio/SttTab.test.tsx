import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { useConnectionsStore } from "@/stores/connections-store";
import { SttTab } from "./SttTab";
import { useAudioStore } from "./store";

vi.mock("./RecorderControls", () => ({
  RecorderControls: ({
    onComplete,
  }: { onComplete: (blob: Blob, mimeType: string, durationMs: number) => void }) => (
    <button
      type="button"
      data-testid="record"
      onClick={() => onComplete(new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }), "audio/webm", 1000)}
    >
      record
    </button>
  ),
}));

const renderStt = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <SttTab />
    </I18nextProvider>,
  );

describe("SttTab", () => {
  beforeEach(() => {
    // jsdom does not implement URL.createObjectURL; stub it to avoid crashes
    // when the audio preview element renders after a blob is adopted.
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock") });
    useAudioStore.setState((s) => ({
      ...s,
      selectedConnectionId: "c1",
      stt: {
        ...s.stt,
        fileName: null, fileSize: null, fileMimeType: null,
        result: null, error: null, sending: false,
      },
    }));
    // Use the real connections-store API (the plan's object-map shape was wrong;
    // we already learned this in Task 11). Reset to empty array, then create.
    useConnectionsStore.setState({ connections: [] } as never);
    useConnectionsStore.getState().create({
      name: "stt", apiBaseUrl: "http://x", apiKey: "k", model: "whisper-1",
      customHeaders: "", queryParams: "", category: "audio", tags: [],
    } as never);
    // Set our test connection id to whatever was created
    const created = useConnectionsStore.getState().list()[0];
    useAudioStore.setState((s) => ({ ...s, selectedConnectionId: created.id }));
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("transcribe button is disabled when no file", () => {
    renderStt();
    expect(screen.getByRole("button", { name: /transcribe/i })).toBeDisabled();
  });

  it("uploads recorded blob and stores transcribed text", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ success: true, text: "hello world", latencyMs: 100 }), {
        status: 200, headers: { "content-type": "application/json" },
      }),
    );
    renderStt();
    fireEvent.click(screen.getByTestId("record"));
    await waitFor(() => expect(useAudioStore.getState().stt.fileName).not.toBeNull());

    await userEvent.click(screen.getByRole("button", { name: /transcribe/i }));
    await waitFor(() => expect(useAudioStore.getState().stt.result).toBe("hello world"));

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/playground/audio/transcriptions");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Headers).get("Content-Type")).toBeNull();
  });
});
