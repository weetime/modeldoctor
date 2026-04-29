import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProbeCtx } from "./index.js";
import { runRerankCohereProbe } from "./rerank-cohere.js";
import { runRerankTEIProbe } from "./rerank-tei.js";

const baseCtx: ProbeCtx = {
  apiBaseUrl: "http://example.test",
  apiKey: "k",
  model: "test-rerank",
  extraHeaders: {},
};

describe("runRerankTEIProbe", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("hits /rerank, body uses TEI shape (texts), returns sorted scores", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify([
            { index: 1, score: 0.9 },
            { index: 0, score: 0.5 },
            { index: 2, score: 0.1 },
          ]),
        ),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runRerankTEIProbe(baseCtx);

    expect(result.pass).toBe(true);
    expect(result.details.rerankResults).toHaveLength(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://example.test/rerank");
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}");
    expect(body.texts).toBeDefined();
    expect(body.documents).toBeUndefined();
  });

  it("uses pathOverride", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify([
            { index: 0, score: 0.8 },
            { index: 1, score: 0.5 },
            { index: 2, score: 0.2 },
          ]),
        ),
    });
    vi.stubGlobal("fetch", fetchMock);

    await runRerankTEIProbe({ ...baseCtx, pathOverride: "/custom/rr" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://example.test/custom/rr");
  });

  it("fails on non-array response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ results: [] })),
      }),
    );
    const result = await runRerankTEIProbe(baseCtx);
    expect(result.pass).toBe(false);
  });
});

describe("runRerankCohereProbe", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("hits /v1/rerank, body uses Cohere shape (documents)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            results: [
              { index: 1, relevance_score: 0.92 },
              { index: 0, relevance_score: 0.41 },
              { index: 2, relevance_score: 0.05 },
            ],
          }),
        ),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runRerankCohereProbe(baseCtx);

    expect(result.pass).toBe(true);
    expect(result.details.rerankResults).toHaveLength(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://example.test/v1/rerank");
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}");
    expect(body.documents).toBeDefined();
    expect(body.texts).toBeUndefined();
  });

  it("uses pathOverride", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            results: [
              { index: 0, relevance_score: 0.7 },
              { index: 1, relevance_score: 0.4 },
              { index: 2, relevance_score: 0.1 },
            ],
          }),
        ),
    });
    vi.stubGlobal("fetch", fetchMock);

    await runRerankCohereProbe({ ...baseCtx, pathOverride: "/custom/coh" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://example.test/custom/coh");
  });
});
