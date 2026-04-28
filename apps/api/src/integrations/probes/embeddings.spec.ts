import { beforeEach, describe, expect, it, vi } from "vitest";
import { runEmbeddingsOpenAIProbe } from "./embeddings-openai.js";
import { runEmbeddingsTEIProbe } from "./embeddings-tei.js";
import type { ProbeCtx } from "./index.js";

const baseCtx: ProbeCtx = {
  apiBaseUrl: "http://example.test",
  apiKey: "k",
  model: "test-embedding",
  extraHeaders: {},
};

describe("runEmbeddingsOpenAIProbe", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("hits /v1/embeddings, asserts data[0].embedding is a numeric array", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({ data: [{ embedding: Array.from({ length: 768 }, () => 0.1) }] }),
        ),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runEmbeddingsOpenAIProbe(baseCtx);

    expect(result.pass).toBe(true);
    expect(result.details.embeddingDims).toBe(768);
    const url = fetchMock.mock.calls[0]?.[0];
    expect(url).toBe("http://example.test/v1/embeddings");
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}");
    expect(body.input).toBeDefined();
    expect(body.model).toBe("test-embedding");
  });

  it("uses pathOverride when supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] })),
    });
    vi.stubGlobal("fetch", fetchMock);

    await runEmbeddingsOpenAIProbe({ ...baseCtx, pathOverride: "/custom/embed-path" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://example.test/custom/embed-path");
  });

  it("fails when response has no embedding array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ data: [] })),
      }),
    );

    const result = await runEmbeddingsOpenAIProbe(baseCtx);

    expect(result.pass).toBe(false);
  });
});

describe("runEmbeddingsTEIProbe", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("hits /embed by default, body uses TEI shape (inputs: [...])", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: () => Promise.resolve(JSON.stringify([Array.from({ length: 384 }, () => 0.05)])),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runEmbeddingsTEIProbe(baseCtx);

    expect(result.pass).toBe(true);
    expect(result.details.embeddingDims).toBe(384);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://example.test/embed");
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}");
    expect(body.inputs).toBeDefined();
    expect(Array.isArray(body.inputs)).toBe(true);
  });
});
