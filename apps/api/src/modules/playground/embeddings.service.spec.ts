import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddingsService } from "./embeddings.service.js";

describe("EmbeddingsService.run", () => {
  let svc: EmbeddingsService;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    svc = new EmbeddingsService();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to {apiBaseUrl}/v1/embeddings with model+input", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }], usage: { prompt_tokens: 1 } }),
        { status: 200 },
      ),
    );
    const out = await svc.run({
      apiBaseUrl: "http://x.test",
      apiKey: "k",
      model: "m",
      input: "hello",
    });
    expect(out.success).toBe(true);
    expect(out.embeddings).toEqual([[0.1, 0.2, 0.3]]);
    expect(out.usage?.prompt_tokens).toBe(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://x.test/v1/embeddings");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ model: "m", input: "hello" });
  });

  it("forwards encodingFormat + dimensions when set", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [] }] }), { status: 200 }),
    );
    await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      input: ["a", "b"],
      encodingFormat: "base64",
      dimensions: 256,
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({
      model: "m",
      input: ["a", "b"],
      encoding_format: "base64",
      dimensions: 256,
    });
  });

  it("honours pathOverride for TEI-style endpoints", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      input: "h",
      pathOverride: "/embed",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("http://x/embed");
  });

  it("returns success=false on non-2xx", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 503 }));
    const out = await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      input: "h",
    });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/503/);
  });

  it("returns success=false on network error", async () => {
    fetchMock.mockRejectedValue(new Error("kaboom"));
    const out = await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      input: "h",
    });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/kaboom/);
  });
});
