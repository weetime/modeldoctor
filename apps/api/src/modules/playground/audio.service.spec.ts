import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioService } from "./audio.service.js";

describe("AudioService.runTts", () => {
  let svc: AudioService;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    svc = new AudioService();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("posts JSON to /v1/audio/speech and returns base64 + format", async () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    fetchMock.mockResolvedValue(
      new Response(wav, { status: 200, headers: { "Content-Type": "audio/wav" } }),
    );
    const out = await svc.runTts({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "tts-1",
      input: "hi",
      voice: "alloy",
      format: "wav",
    });
    expect(out.success).toBe(true);
    expect(out.format).toBe("wav");
    expect(out.audioBase64).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://x/v1/audio/speech");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: "tts-1",
      input: "hi",
      voice: "alloy",
      response_format: "wav",
    });
  });

  it("normalizes upstream non-2xx into success=false with truncated body", async () => {
    fetchMock.mockResolvedValue(new Response("server error xxxxx", { status: 502 }));
    const out = await svc.runTts({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "tts-1",
      input: "hi",
      voice: "alloy",
      format: "mp3",
    });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/upstream 502/);
  });

  it("rejects audio larger than 20MB", async () => {
    const huge = new Uint8Array(21 * 1024 * 1024);
    fetchMock.mockResolvedValue(
      new Response(huge, { status: 200, headers: { "Content-Type": "audio/mpeg" } }),
    );
    const out = await svc.runTts({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "tts-1",
      input: "hi",
      voice: "alloy",
      format: "mp3",
    });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/audio too large/i);
  });
});

describe("AudioService.runTranscriptions", () => {
  let svc: AudioService;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    svc = new AudioService();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("posts multipart to /v1/audio/transcriptions and returns text", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ text: "hello world" }), { status: 200 }),
    );
    const out = await svc.runTranscriptions({
      file: {
        buffer: Buffer.from([1, 2, 3]),
        originalname: "a.wav",
        mimetype: "audio/wav",
        size: 3,
      },
      body: {
        apiBaseUrl: "http://x",
        apiKey: "k",
        model: "whisper-1",
        task: "transcribe",
        language: "zh",
      },
    });
    expect(out.success).toBe(true);
    expect(out.text).toBe("hello world");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://x/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    // Content-Type must NOT be set on the request — fetch derives the boundary
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
    expect(headers.Authorization).toBe("Bearer k");
  });

  it("normalizes upstream errors", async () => {
    fetchMock.mockResolvedValue(new Response("bad request", { status: 400 }));
    const out = await svc.runTranscriptions({
      file: { buffer: Buffer.from([1]), originalname: "a.wav", mimetype: "audio/wav", size: 1 },
      body: { apiBaseUrl: "http://x", apiKey: "k", model: "whisper-1", task: "transcribe" },
    });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/upstream 400/);
  });
});
