import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DecryptedConnection } from "../connection/connection.service.js";
import { RerankService } from "./rerank.service.js";

function makeConn(overrides: Partial<DecryptedConnection> = {}): DecryptedConnection {
  return {
    id: "conn-1",
    name: "test",
    baseUrl: "http://x",
    apiKey: "k",
    model: "m",
    customHeaders: "",
    queryParams: "",
    category: "rerank",
    tokenizerHfId: null,
    ...overrides,
  };
}

describe("RerankService.run", () => {
  let svc: RerankService;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    svc = new RerankService();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cohere wire posts to /v1/rerank with documents+top_n", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { index: 1, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.4 },
          ],
        }),
        { status: 200 },
      ),
    );
    const out = await svc.run(makeConn(), {
      connectionId: "conn-1",
      query: "q",
      documents: ["a", "b"],
      topN: 2,
      wire: "cohere",
    });
    expect(out.success).toBe(true);
    expect(out.results).toEqual([
      { index: 1, score: 0.9 },
      { index: 0, score: 0.4 },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://x/v1/rerank");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ model: "m", query: "q", documents: ["a", "b"], top_n: 2 });
  });

  it("tei wire posts to /rerank with texts and parses top-level array", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          { index: 0, score: 0.8 },
          { index: 1, score: 0.2 },
        ]),
        { status: 200 },
      ),
    );
    const out = await svc.run(makeConn(), {
      connectionId: "conn-1",
      query: "q",
      documents: ["a", "b"],
      wire: "tei",
    });
    expect(out.success).toBe(true);
    expect(out.results).toEqual([
      { index: 0, score: 0.8 },
      { index: 1, score: 0.2 },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://x/rerank");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      model: "m",
      query: "q",
      texts: ["a", "b"],
    });
  });

  it("returns success=false on non-2xx", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    const out = await svc.run(makeConn(), {
      connectionId: "conn-1",
      query: "q",
      documents: ["a"],
      wire: "cohere",
    });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/500/);
  });
});
