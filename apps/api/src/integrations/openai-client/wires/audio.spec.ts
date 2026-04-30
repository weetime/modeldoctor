import { describe, expect, it } from "vitest";
import {
  buildPlaygroundTtsBody,
  parsePlaygroundTtsResponse,
  buildPlaygroundTranscriptionsFormData,
  parsePlaygroundTranscriptionsResponse,
} from "./audio.js";

describe("buildPlaygroundTtsBody", () => {
  it("maps fields to OpenAI shape", () => {
    expect(
      buildPlaygroundTtsBody({ model: "tts-1", input: "hi", voice: "alloy", format: "mp3", speed: 1.2 }),
    ).toEqual({ model: "tts-1", input: "hi", voice: "alloy", response_format: "mp3", speed: 1.2 });
  });

  it("omits speed when undefined", () => {
    const body = buildPlaygroundTtsBody({ model: "tts-1", input: "hi", voice: "alloy", format: "wav" });
    expect(body).not.toHaveProperty("speed");
  });
});

describe("parsePlaygroundTtsResponse", () => {
  it("returns base64 + sniffed format for WAV bytes", async () => {
    // Minimal WAV header: 'RIFF' + size + 'WAVE'
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    const res = new Response(wav, { status: 200, headers: { "Content-Type": "audio/wav" } });
    const out = await parsePlaygroundTtsResponse(res);
    expect(out.format).toBe("wav");
    expect(out.audioBase64.length).toBeGreaterThan(0);
    expect(out.bytes).toBe(12);
  });

  it("rejects payloads larger than 20MB", async () => {
    const huge = new Uint8Array(21 * 1024 * 1024);
    const res = new Response(huge, { status: 200, headers: { "Content-Type": "audio/wav" } });
    await expect(parsePlaygroundTtsResponse(res)).rejects.toThrow(/audio too large/i);
  });
});

describe("buildPlaygroundTranscriptionsFormData", () => {
  it("appends file + model + optional fields", () => {
    const buf = Buffer.from([1, 2, 3, 4]);
    const form = buildPlaygroundTranscriptionsFormData({
      file: { buffer: buf, originalname: "a.wav", mimetype: "audio/wav" },
      model: "whisper-1",
      language: "zh",
      task: "transcribe",
    });
    const entries = Array.from(form.entries());
    const keys = entries.map(([k]) => k);
    expect(keys).toContain("file");
    expect(keys).toContain("model");
    expect(keys).toContain("language");
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("language")).toBe("zh");
    expect(form.get("task")).toBe("transcribe");
  });

  it("skips empty language and undefined optional fields", () => {
    const form = buildPlaygroundTranscriptionsFormData({
      file: { buffer: Buffer.from([]), originalname: "a.wav", mimetype: "audio/wav" },
      model: "whisper-1",
      language: "",
    });
    const keys = Array.from(form.keys());
    expect(keys).not.toContain("language");
    expect(keys).not.toContain("prompt");
    expect(keys).not.toContain("temperature");
  });

  it("appends temperature as string when provided", () => {
    const form = buildPlaygroundTranscriptionsFormData({
      file: { buffer: Buffer.from([0]), originalname: "a.wav", mimetype: "audio/wav" },
      model: "whisper-1",
      temperature: 0.3,
    });
    expect(form.get("temperature")).toBe("0.3");
  });
});

describe("parsePlaygroundTranscriptionsResponse", () => {
  it("extracts text", () => {
    expect(parsePlaygroundTranscriptionsResponse({ text: "hello" })).toEqual({ text: "hello" });
  });

  it("returns empty text when missing", () => {
    expect(parsePlaygroundTranscriptionsResponse({})).toEqual({ text: "" });
  });
});
