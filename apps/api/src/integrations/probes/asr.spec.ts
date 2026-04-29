import { beforeEach, describe, expect, it, vi } from "vitest";
import { runASRProbe } from "./asr.js";
import type { ProbeCtx } from "./index.js";

const baseCtx: ProbeCtx = {
  apiBaseUrl: "http://example.test",
  apiKey: "k",
  model: "whisper-1",
  extraHeaders: {},
};

describe("runASRProbe", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs multipart to /v1/audio/transcriptions, asserts text in JSON response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ text: "(silence)" })),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runASRProbe(baseCtx);

    expect(result.pass).toBe(true);
    const url = fetchMock.mock.calls[0]?.[0];
    expect(url).toBe("http://example.test/v1/audio/transcriptions");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("uses pathOverride", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ text: "x" })),
    });
    vi.stubGlobal("fetch", fetchMock);

    await runASRProbe({ ...baseCtx, pathOverride: "/custom/asr" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://example.test/custom/asr");
  });

  it("fails when response has no `text` field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: () => Promise.resolve(JSON.stringify({})),
      }),
    );

    const result = await runASRProbe(baseCtx);

    expect(result.pass).toBe(false);
  });

  it("surfaces empty-string text as a successful pass (silence transcribes empty)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ text: "" })),
      }),
    );

    const result = await runASRProbe(baseCtx);

    expect(result.pass).toBe(true);
    expect(result.details.textReply).toBe("");
  });
});
