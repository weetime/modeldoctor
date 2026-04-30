import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AudioController } from "./audio.controller.js";
import { AudioService } from "./audio.service.js";

type MulterFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
  fieldname?: string;
  encoding?: string;
};

function makeFile(overrides: Partial<MulterFile> = {}): MulterFile {
  return {
    buffer: Buffer.from([1, 2, 3]),
    originalname: "audio.wav",
    mimetype: "audio/wav",
    size: 3,
    fieldname: "file",
    encoding: "7bit",
    ...overrides,
  };
}

describe("AudioController.transcriptions", () => {
  it("rejects when file is missing", async () => {
    const svc = { runTranscriptions: vi.fn() } as unknown as AudioService;
    const ctrl = new AudioController(svc);
    await expect(
      ctrl.transcriptions(undefined as never, { apiBaseUrl: "http://x", apiKey: "k", model: "m" }),
    ).rejects.toThrow(BadRequestException);
    expect(svc.runTranscriptions).not.toHaveBeenCalled();
  });

  it("rejects when form fields fail zod", async () => {
    const svc = { runTranscriptions: vi.fn() } as unknown as AudioService;
    const ctrl = new AudioController(svc);
    await expect(
      ctrl.transcriptions(makeFile() as never, { apiBaseUrl: "", apiKey: "", model: "" }),
    ).rejects.toThrow(BadRequestException);
  });

  it("invokes svc.runTranscriptions with file + parsed body when valid", async () => {
    const runTranscriptions = vi
      .fn()
      .mockResolvedValue({ success: true, text: "hi", latencyMs: 5 });
    const svc = { runTranscriptions } as unknown as AudioService;
    const ctrl = new AudioController(svc);
    const out = await ctrl.transcriptions(makeFile() as never, {
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "whisper-1",
      task: "transcribe",
    });
    expect(out).toEqual({ success: true, text: "hi", latencyMs: 5 });
    expect(runTranscriptions).toHaveBeenCalledOnce();
    const arg = runTranscriptions.mock.calls[0][0];
    expect(arg.file.originalname).toBe("audio.wav");
    expect(arg.body.task).toBe("transcribe");
  });
});

describe("AudioController.tts", () => {
  it("delegates body to svc.runTts", async () => {
    const runTts = vi
      .fn()
      .mockResolvedValue({ success: true, audioBase64: "b", format: "mp3", latencyMs: 1 });
    const svc = { runTts } as unknown as AudioService;
    const ctrl = new AudioController(svc);
    const out = await ctrl.tts({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "tts-1",
      input: "hi",
      voice: "alloy",
      format: "mp3",
    });
    expect(out.success).toBe(true);
    expect(runTts).toHaveBeenCalledOnce();
  });

  it("throws 400 when reference_audio_base64 decoded bytes exceed 15 MB", async () => {
    const svc = { runTts: vi.fn() } as unknown as AudioService;
    const ctrl = new AudioController(svc);
    // 15 MB + 1 byte decoded => base64 length ~ ceil((15*1024*1024+1) / 3) * 4
    // We fake the b64 body as a long string: decoded = b64.length * 0.75 > 15MB
    // => b64.length must be > 15*1024*1024/0.75 = 20*1024*1024
    const bigB64 = "A".repeat(Math.ceil((15 * 1024 * 1024 + 1) / 0.75));
    const fakeDataUrl = `data:audio/wav;base64,${bigB64}`;
    expect(() =>
      ctrl.tts({
        apiBaseUrl: "http://x",
        apiKey: "k",
        model: "tts-1",
        input: "hi",
        voice: "alloy",
        format: "wav",
        reference_audio_base64: fakeDataUrl,
      }),
    ).toThrow(BadRequestException);
    expect(svc.runTts).not.toHaveBeenCalled();
  });

  it("accepts reference_audio_base64 within 15 MB and passes through", async () => {
    const runTts = vi
      .fn()
      .mockResolvedValue({ success: true, audioBase64: "b", format: "mp3", latencyMs: 1 });
    const svc = { runTts } as unknown as AudioService;
    const ctrl = new AudioController(svc);
    const smallDataUrl = "data:audio/wav;base64,UklGRgAAAA==";
    await ctrl.tts({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "tts-1",
      input: "hi",
      voice: "alloy",
      format: "wav",
      reference_audio_base64: smallDataUrl,
      reference_text: "hi there",
    });
    expect(runTts).toHaveBeenCalledOnce();
    const arg = (
      runTts.mock.calls[0] as [{ reference_audio_base64?: string; reference_text?: string }]
    )[0];
    expect(arg.reference_audio_base64).toBe(smallDataUrl);
    expect(arg.reference_text).toBe("hi there");
  });
});
