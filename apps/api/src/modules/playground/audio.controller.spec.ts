import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AudioController } from "./audio.controller.js";
import { AudioService } from "./audio.service.js";

type MulterFile = { buffer: Buffer; originalname: string; mimetype: string; size: number; fieldname?: string; encoding?: string };

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
    const runTranscriptions = vi.fn().mockResolvedValue({ success: true, text: "hi", latencyMs: 5 });
    const svc = { runTranscriptions } as unknown as AudioService;
    const ctrl = new AudioController(svc);
    const out = await ctrl.transcriptions(makeFile() as never, {
      apiBaseUrl: "http://x", apiKey: "k", model: "whisper-1", task: "transcribe",
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
    const runTts = vi.fn().mockResolvedValue({ success: true, audioBase64: "b", format: "mp3", latencyMs: 1 });
    const svc = { runTts } as unknown as AudioService;
    const ctrl = new AudioController(svc);
    const out = await ctrl.tts({
      apiBaseUrl: "http://x", apiKey: "k", model: "tts-1", input: "hi", voice: "alloy", format: "mp3",
    });
    expect(out.success).toBe(true);
    expect(runTts).toHaveBeenCalledOnce();
  });
});
