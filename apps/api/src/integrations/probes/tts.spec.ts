import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProbeCtx } from "./index.js";
import { runTTSProbe } from "./tts.js";

const baseCtx: ProbeCtx = {
  apiBaseUrl: "http://example.test",
  apiKey: "k",
  model: "tts-1",
  extraHeaders: {},
};

// 12 bytes: "RIFF" + 4 bytes + "WAVE"
const WAV_HEADER = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);

function asArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe("runTTSProbe", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs /v1/audio/speech with { model, input, voice }, asserts WAV magic + size > 1KB", async () => {
    const audio = Buffer.concat([WAV_HEADER, Buffer.alloc(2048, 0)]);
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "audio/wav" : null) },
      arrayBuffer: () => Promise.resolve(asArrayBuffer(audio)),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTTSProbe(baseCtx);

    expect(result.pass).toBe(true);
    const url = fetchMock.mock.calls[0]?.[0];
    expect(url).toBe("http://example.test/v1/audio/speech");
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}");
    expect(body.model).toBe("tts-1");
    expect(typeof body.input).toBe("string");
    expect(typeof body.voice).toBe("string");
    expect(result.details.audioBytes).toBe(2060);
    expect(result.details.audioB64).toBeDefined();
  });

  it("fails on JSON body (server returned an error envelope, not audio)", async () => {
    const json = Buffer.from('{"error":"unauthorized"}');
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 401,
        ok: false,
        headers: { get: () => "application/json" },
        arrayBuffer: () => Promise.resolve(asArrayBuffer(json)),
      }),
    );

    const result = await runTTSProbe(baseCtx);

    expect(result.pass).toBe(false);
  });

  it("uses pathOverride when supplied", async () => {
    const audio = Buffer.concat([WAV_HEADER, Buffer.alloc(2048, 0)]);
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "audio/wav" : null) },
      arrayBuffer: () => Promise.resolve(asArrayBuffer(audio)),
    });
    vi.stubGlobal("fetch", fetchMock);

    await runTTSProbe({ ...baseCtx, pathOverride: "/custom/tts" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://example.test/custom/tts");
  });

  it("MP3 response passes the probe but does NOT carry audioB64 (only WAV is previewable)", async () => {
    // ID3 magic (MP3 tag-header)
    const audio = Buffer.concat([Buffer.from([0x49, 0x44, 0x33]), Buffer.alloc(2048, 0)]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "audio/mpeg" : null) },
        arrayBuffer: () => Promise.resolve(asArrayBuffer(audio)),
      }),
    );

    const result = await runTTSProbe(baseCtx);

    expect(result.pass).toBe(true);
    expect(result.details.audioB64).toBeUndefined();
  });
});
