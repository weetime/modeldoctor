import { describe, expect, it } from "vitest";
import {
  type ChatMessage,
  ChatMessageSchema,
  type PlaygroundChatRequest,
  PlaygroundChatRequestSchema,
  type PlaygroundChatResponse,
  PlaygroundChatResponseSchema,
  PlaygroundEmbeddingsRequestSchema,
  PlaygroundEmbeddingsResponseSchema,
  PlaygroundImagesRequestSchema,
  PlaygroundImagesResponseSchema,
  PlaygroundRerankRequestSchema,
  PlaygroundRerankResponseSchema,
} from "./playground.js";

describe("ChatMessageSchema", () => {
  it("accepts a string-content message", () => {
    expect(() => ChatMessageSchema.parse({ role: "user", content: "hello" })).not.toThrow();
  });

  it("accepts a content-parts array with text + image_url", () => {
    expect(() =>
      ChatMessageSchema.parse({
        role: "user",
        content: [
          { type: "text", text: "what is in this image?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,iVB..." } },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects an unknown role", () => {
    expect(() => ChatMessageSchema.parse({ role: "tool", content: "hi" })).toThrow();
  });
});

describe("PlaygroundChatRequestSchema", () => {
  const base = {
    apiBaseUrl: "http://x.test",
    apiKey: "k",
    model: "m",
    messages: [{ role: "user", content: "hi" }],
  };

  it("accepts a minimal request", () => {
    expect(() => PlaygroundChatRequestSchema.parse(base)).not.toThrow();
  });

  it("requires at least one message", () => {
    expect(() => PlaygroundChatRequestSchema.parse({ ...base, messages: [] })).toThrow();
  });

  it("defaults params to an empty object", () => {
    const out = PlaygroundChatRequestSchema.parse(base);
    expect(out.params).toEqual({});
  });
});

describe("PlaygroundChatResponseSchema", () => {
  it("accepts the OK shape", () => {
    expect(() =>
      PlaygroundChatResponseSchema.parse({
        success: true,
        content: "hi back",
        latencyMs: 123,
      }),
    ).not.toThrow();
  });

  it("accepts an error shape", () => {
    expect(() =>
      PlaygroundChatResponseSchema.parse({
        success: false,
        error: "upstream 500",
        latencyMs: 50,
      }),
    ).not.toThrow();
  });
});

describe("PlaygroundEmbeddingsRequestSchema", () => {
  const base = { apiBaseUrl: "http://x", apiKey: "k", model: "m", input: "one" };
  it("accepts string input", () => {
    expect(() => PlaygroundEmbeddingsRequestSchema.parse(base)).not.toThrow();
  });
  it("accepts string[] input", () => {
    expect(() =>
      PlaygroundEmbeddingsRequestSchema.parse({ ...base, input: ["a", "b"] }),
    ).not.toThrow();
  });
  it("rejects empty string[] input", () => {
    expect(() => PlaygroundEmbeddingsRequestSchema.parse({ ...base, input: [] })).toThrow();
  });
  it("validates encodingFormat enum", () => {
    expect(() =>
      PlaygroundEmbeddingsRequestSchema.parse({ ...base, encodingFormat: "bogus" }),
    ).toThrow();
  });
});

describe("PlaygroundEmbeddingsResponseSchema", () => {
  it("accepts the OK shape", () => {
    expect(() =>
      PlaygroundEmbeddingsResponseSchema.parse({
        success: true,
        embeddings: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
        latencyMs: 12,
      }),
    ).not.toThrow();
  });
});

describe("PlaygroundRerankRequestSchema", () => {
  const base = {
    apiBaseUrl: "http://x",
    apiKey: "k",
    model: "m",
    query: "q",
    documents: ["a", "b"],
  };
  it("defaults wire to 'cohere'", () => {
    const out = PlaygroundRerankRequestSchema.parse(base);
    expect(out.wire).toBe("cohere");
  });
  it("rejects empty documents", () => {
    expect(() => PlaygroundRerankRequestSchema.parse({ ...base, documents: [] })).toThrow();
  });
});

describe("PlaygroundRerankResponseSchema", () => {
  it("accepts results with index + score", () => {
    expect(() =>
      PlaygroundRerankResponseSchema.parse({
        success: true,
        results: [{ index: 0, score: 0.9 }],
        latencyMs: 5,
      }),
    ).not.toThrow();
  });
});

describe("PlaygroundImagesRequestSchema", () => {
  const base = { apiBaseUrl: "http://x", apiKey: "k", model: "m", prompt: "p" };
  it("accepts minimal request", () => {
    expect(() => PlaygroundImagesRequestSchema.parse(base)).not.toThrow();
  });
  it("validates n is positive int", () => {
    expect(() => PlaygroundImagesRequestSchema.parse({ ...base, n: 0 })).toThrow();
  });
  it("validates responseFormat enum", () => {
    expect(() =>
      PlaygroundImagesRequestSchema.parse({ ...base, responseFormat: "bogus" }),
    ).toThrow();
  });
});

describe("PlaygroundImagesResponseSchema", () => {
  it("accepts artifacts with url-only or b64-only entries", () => {
    expect(() =>
      PlaygroundImagesResponseSchema.parse({
        success: true,
        artifacts: [{ url: "http://a" }, { b64Json: "AAA" }],
        latencyMs: 50,
      }),
    ).not.toThrow();
  });
});
