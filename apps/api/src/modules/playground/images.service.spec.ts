import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImagesService } from "./images.service.js";

describe("ImagesService.run", () => {
  let svc: ImagesService;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    svc = new ImagesService();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to {apiBaseUrl}/v1/images/generations with prompt+size+n", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ url: "http://image/0" }] }), { status: 200 }),
    );
    const out = await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      prompt: "a red apple",
      size: "512x512",
      n: 1,
    });
    expect(out.success).toBe(true);
    expect(out.artifacts).toEqual([{ url: "http://image/0", b64Json: undefined }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://x/v1/images/generations");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ model: "m", prompt: "a red apple", size: "512x512", n: 1 });
  });

  it("forwards responseFormat + seed when set", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: "AAA" }] }), { status: 200 }),
    );
    await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      prompt: "p",
      responseFormat: "b64_json",
      seed: 42,
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ response_format: "b64_json", seed: 42 });
  });

  it("returns success=false on non-2xx", async () => {
    fetchMock.mockResolvedValue(new Response("denied", { status: 403 }));
    const out = await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      prompt: "p",
    });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/403/);
  });
});
