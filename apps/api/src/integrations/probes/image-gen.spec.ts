import { beforeEach, describe, expect, it, vi } from "vitest";
import { runImageGenProbe } from "./image-gen.js";
import type { ProbeCtx } from "./index.js";

const baseCtx: ProbeCtx = {
  apiBaseUrl: "http://example.test",
  apiKey: "k",
  model: "dall-e-3",
  extraHeaders: {},
};

describe("runImageGenProbe", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("passes when response has data[0].url", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({ data: [{ url: "https://example.test/img.png" }] })),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runImageGenProbe(baseCtx);

    expect(result.pass).toBe(true);
    expect(result.details.imageGenUrl).toBe("https://example.test/img.png");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://example.test/v1/images/generations");
  });

  it("passes when response has data[0].b64_json", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ data: [{ b64_json: "iVBORw0KGgo=" }] })),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runImageGenProbe(baseCtx);

    expect(result.pass).toBe(true);
    expect(result.details.imageGenB64).toBe("iVBORw0KGgo=");
  });

  it("fails when neither url nor b64_json present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ data: [{}] })),
      }),
    );

    const result = await runImageGenProbe(baseCtx);

    expect(result.pass).toBe(false);
  });

  it("uses pathOverride", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({ data: [{ url: "https://example.test/x.png" }] })),
    });
    vi.stubGlobal("fetch", fetchMock);

    await runImageGenProbe({ ...baseCtx, pathOverride: "/custom/img" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://example.test/custom/img");
  });
});
