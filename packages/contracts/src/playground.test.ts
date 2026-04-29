import { describe, expect, it } from "vitest";
import {
  type ChatMessage,
  ChatMessageSchema,
  type PlaygroundChatRequest,
  PlaygroundChatRequestSchema,
  type PlaygroundChatResponse,
  PlaygroundChatResponseSchema,
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
