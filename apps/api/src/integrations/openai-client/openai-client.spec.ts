import { describe, expect, it } from "vitest";
import { buildHeaders, buildUrl, parseHeaderLines, parseQueryLines } from "./url.js";

describe("parseHeaderLines", () => {
  it("returns empty record for undefined / blank", () => {
    expect(parseHeaderLines(undefined)).toEqual({});
    expect(parseHeaderLines("")).toEqual({});
    expect(parseHeaderLines("   \n  ")).toEqual({});
  });

  it("parses 'K: v' lines, trims, ignores malformed", () => {
    expect(parseHeaderLines("X-Foo: bar\n  X-Baz : qux \nignored\nX-Empty:")).toEqual({
      "X-Foo": "bar",
      "X-Baz": "qux",
      "X-Empty": "",
    });
  });
});

describe("parseQueryLines", () => {
  it("parses 'k=v' lines", () => {
    expect(parseQueryLines("api-version=2024-02-01\nfoo=bar\n=skipme")).toEqual({
      "api-version": "2024-02-01",
      foo: "bar",
    });
  });
});

describe("buildHeaders", () => {
  it("merges Authorization + Content-Type with custom headers", () => {
    const h = buildHeaders("sk-1", "X-Foo: bar");
    expect(h.Authorization).toBe("Bearer sk-1");
    expect(h["Content-Type"]).toBe("application/json");
    expect(h["X-Foo"]).toBe("bar");
  });

  it("lets caller override Content-Type via customHeaders", () => {
    const h = buildHeaders("k", "Content-Type: multipart/form-data");
    expect(h["Content-Type"]).toBe("multipart/form-data");
  });
});

describe("buildUrl", () => {
  it("joins base + default path, collapses trailing slash", () => {
    expect(buildUrl({ apiBaseUrl: "http://x.test/", defaultPath: "/v1/chat/completions" })).toBe(
      "http://x.test/v1/chat/completions",
    );
  });

  it("uses pathOverride when given", () => {
    expect(
      buildUrl({
        apiBaseUrl: "http://x",
        defaultPath: "/v1/chat/completions",
        pathOverride: "/custom",
      }),
    ).toBe("http://x/custom");
  });

  it("normalises pathOverride lacking a leading slash", () => {
    expect(buildUrl({ apiBaseUrl: "http://x", defaultPath: "/d", pathOverride: "custom" })).toBe(
      "http://x/custom",
    );
  });

  it("appends queryParams as URLSearchParams", () => {
    const url = buildUrl({
      apiBaseUrl: "http://x",
      defaultPath: "/v1/embeddings",
      queryParams: "api-version=2024-02-01\nfoo=bar",
    });
    expect(url).toMatch(/^http:\/\/x\/v1\/embeddings\?/);
    expect(url).toContain("api-version=2024-02-01");
    expect(url).toContain("foo=bar");
  });

  it("uses & if pathOverride already contains ?", () => {
    const url = buildUrl({
      apiBaseUrl: "http://x",
      defaultPath: "/d",
      pathOverride: "/p?a=1",
      queryParams: "b=2",
    });
    expect(url).toBe("http://x/p?a=1&b=2");
  });
});

import { buildPlaygroundChatBody, parsePlaygroundChatResponse } from "./wires/chat.js";
import { buildPlaygroundEmbeddingsBody, parseEmbeddingsResponse } from "./wires/embeddings.js";
import { buildPlaygroundImagesBody, parseImagesResponse } from "./wires/images.js";
import { buildPlaygroundRerankBody, parseRerankResponse } from "./wires/rerank.js";

describe("wires/chat", () => {
  const messages = [{ role: "user" as const, content: "hi" }];

  it("buildPlaygroundChatBody returns OpenAI shape with snake_case mapping", () => {
    const body = buildPlaygroundChatBody({
      model: "m",
      messages,
      params: {
        temperature: 0.5,
        maxTokens: 100,
        topP: 0.9,
        frequencyPenalty: 0.1,
        presencePenalty: 0.2,
        seed: 7,
        stop: ["</s>"],
        stream: true,
      },
    });
    expect(body).toEqual({
      model: "m",
      messages,
      temperature: 0.5,
      max_tokens: 100,
      top_p: 0.9,
      frequency_penalty: 0.1,
      presence_penalty: 0.2,
      seed: 7,
      stop: ["</s>"],
      stream: true,
    });
  });

  it("buildPlaygroundChatBody omits undefined params", () => {
    const body = buildPlaygroundChatBody({ model: "m", messages, params: {} });
    expect(body).toEqual({ model: "m", messages });
  });

  it("parsePlaygroundChatResponse returns content + usage", () => {
    expect(
      parsePlaygroundChatResponse({
        choices: [{ message: { content: "hello" } }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
    ).toEqual({
      content: "hello",
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
  });

  it("parsePlaygroundChatResponse defaults content to empty string", () => {
    expect(parsePlaygroundChatResponse({})).toEqual({ content: "", usage: undefined });
  });
});

describe("wires/embeddings", () => {
  it("buildPlaygroundEmbeddingsBody supports single + array input", () => {
    expect(buildPlaygroundEmbeddingsBody({ model: "m", input: "one" })).toEqual({
      model: "m",
      input: "one",
    });
    expect(buildPlaygroundEmbeddingsBody({ model: "m", input: ["a", "b"] })).toEqual({
      model: "m",
      input: ["a", "b"],
    });
  });

  it("buildPlaygroundEmbeddingsBody adds optional encoding_format and dimensions", () => {
    expect(
      buildPlaygroundEmbeddingsBody({
        model: "m",
        input: "x",
        encodingFormat: "base64",
        dimensions: 256,
      }),
    ).toEqual({ model: "m", input: "x", encoding_format: "base64", dimensions: 256 });
  });

  it("parseEmbeddingsResponse returns array of vectors + usage", () => {
    expect(
      parseEmbeddingsResponse({
        data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
        usage: { prompt_tokens: 5, total_tokens: 5 },
      }),
    ).toEqual({
      embeddings: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });
  });

  it("parseEmbeddingsResponse decodes base64 float32 embeddings", () => {
    // Encode two vectors as little-endian float32 base64 strings.
    const enc = (vec: number[]): string => {
      const f = new Float32Array(vec);
      return Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString("base64");
    };
    const result = parseEmbeddingsResponse({
      data: [{ embedding: enc([1.0, -2.0, 0.5]) }, { embedding: enc([0.25, 0.5]) }],
    });
    expect(result.embeddings).toHaveLength(2);
    expect(result.embeddings[0]).toEqual([1.0, -2.0, 0.5]);
    expect(result.embeddings[1]).toEqual([0.25, 0.5]);
  });
});

describe("wires/rerank", () => {
  it("buildPlaygroundRerankBody emits cohere shape by default (documents + top_n)", () => {
    expect(
      buildPlaygroundRerankBody({
        model: "m",
        query: "q",
        documents: ["a", "b"],
        topN: 3,
        returnDocuments: true,
        wire: "cohere",
      }),
    ).toEqual({ model: "m", query: "q", documents: ["a", "b"], top_n: 3, return_documents: true });
  });

  it("buildPlaygroundRerankBody emits tei shape when wire=tei (texts, no top_n)", () => {
    expect(
      buildPlaygroundRerankBody({ model: "m", query: "q", documents: ["a", "b"], wire: "tei" }),
    ).toEqual({ model: "m", query: "q", texts: ["a", "b"] });
  });

  it("parseRerankResponse handles cohere {results: [{index, relevance_score}]}", () => {
    expect(
      parseRerankResponse({
        results: [
          { index: 1, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.4 },
        ],
      }),
    ).toEqual([
      { index: 1, score: 0.9 },
      { index: 0, score: 0.4 },
    ]);
  });

  it("parseRerankResponse handles tei top-level [{index, score}]", () => {
    expect(
      parseRerankResponse([
        { index: 0, score: 0.8 },
        { index: 1, score: 0.2 },
      ]),
    ).toEqual([
      { index: 0, score: 0.8 },
      { index: 1, score: 0.2 },
    ]);
  });
});

describe("wires/images", () => {
  it("buildPlaygroundImagesBody includes optional size / n / response_format / seed", () => {
    expect(
      buildPlaygroundImagesBody({
        model: "m",
        prompt: "p",
        size: "512x512",
        n: 2,
        responseFormat: "b64_json",
        seed: 42,
      }),
    ).toEqual({
      model: "m",
      prompt: "p",
      size: "512x512",
      n: 2,
      response_format: "b64_json",
      seed: 42,
    });
  });

  it("parseImagesResponse returns artifacts array preserving url and b64_json", () => {
    expect(
      parseImagesResponse({
        data: [{ url: "http://i/0" }, { b64_json: "AAA" }],
      }),
    ).toEqual([
      { url: "http://i/0", b64Json: undefined },
      { url: undefined, b64Json: "AAA" },
    ]);
  });
});

import { pipeUpstreamSseToResponse } from "./sse.js";

describe("pipeUpstreamSseToResponse", () => {
  it("copies upstream chunks to res.write and ends res", async () => {
    // Build a minimal Web ReadableStream from text chunks
    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode("data: hello\n\n"));
        c.enqueue(encoder.encode("data: world\n\n"));
        c.close();
      },
    });
    const written: string[] = [];
    let ended = false;
    const res = {
      write: (chunk: Uint8Array) => {
        written.push(new TextDecoder().decode(chunk));
        return true;
      },
      end: () => {
        ended = true;
      },
      on: () => {},
    } as unknown as import("express").Response;
    const ac = new AbortController();
    await pipeUpstreamSseToResponse(upstream, res, ac);
    expect(written.join("")).toBe("data: hello\n\ndata: world\n\n");
    expect(ended).toBe(true);
  });

  it("aborts upstream when res emits 'close' before drain", async () => {
    let aborted = false;
    const upstream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("data: 1\n\n"));
        // do not close — wait for cancel
      },
      cancel() {
        aborted = true;
      },
    });
    const handlers: Record<string, () => void> = {};
    const res = {
      write: () => true,
      end: () => {},
      on: (ev: string, cb: () => void) => {
        handlers[ev] = cb;
      },
    } as unknown as import("express").Response;
    const ac = new AbortController();
    const p = pipeUpstreamSseToResponse(upstream, res, ac);
    handlers.close?.();
    await p;
    expect(aborted).toBe(true);
    expect(ac.signal.aborted).toBe(true);
  });
});
