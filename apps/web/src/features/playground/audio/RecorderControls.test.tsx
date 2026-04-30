import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { RecorderControls } from "./RecorderControls";

function setIsSecureContext(v: boolean) {
  Object.defineProperty(window, "isSecureContext", { value: v, configurable: true });
}

class MockMediaRecorder {
  static isTypeSupported = vi.fn().mockReturnValue(true);
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  start() { this.state = "recording"; }
  stop() {
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }) });
    this.onstop?.();
    this.state = "inactive";
  }
  constructor(public stream: MediaStream, public options?: { mimeType?: string }) {
    if (options?.mimeType) this.mimeType = options.mimeType;
  }
}

const fakeStream = {
  getTracks: () => [{ stop: vi.fn() }, { stop: vi.fn() }],
} as unknown as MediaStream;

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", MockMediaRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream) },
    configurable: true,
  });
  setIsSecureContext(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderRC = (onComplete = vi.fn()) =>
  render(
    <I18nextProvider i18n={i18n}>
      <RecorderControls onComplete={onComplete} />
    </I18nextProvider>,
  );

describe("RecorderControls", () => {
  it("disables button when not in secure context", () => {
    setIsSecureContext(false);
    renderRC();
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("enables button when in secure context with mediaDevices", () => {
    renderRC();
    expect(screen.getByRole("button")).toBeEnabled();
  });

  it("calls getUserMedia + onComplete when start → stop", async () => {
    const onComplete = vi.fn();
    renderRC(onComplete);
    fireEvent.click(screen.getByRole("button"));
    await new Promise((r) => setTimeout(r, 0));  // flush getUserMedia microtask
    fireEvent.click(screen.getByRole("button"));  // stop
    expect(onComplete).toHaveBeenCalledOnce();
    const [blob, mimeType] = onComplete.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(mimeType).toMatch(/audio\/webm/);
  });

  it("releases tracks after stopping", async () => {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => tracks } as unknown as MediaStream),
      },
      configurable: true,
    });
    renderRC();
    fireEvent.click(screen.getByRole("button"));
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(screen.getByRole("button"));
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(tracks[1].stop).toHaveBeenCalled();
  });
});
