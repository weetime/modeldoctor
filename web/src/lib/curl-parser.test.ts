import { describe, expect, it } from "vitest";
import { detectApiType, parseCurlCommand } from "./curl-parser";

describe("parseCurlCommand", () => {
  it("extracts URL", () => {
    const r = parseCurlCommand(`curl http://x.test/v1/chat/completions`);
    expect(r.url).toBe("http://x.test/v1/chat/completions");
  });

  it("extracts URL with quoted form", () => {
    const r = parseCurlCommand(`curl 'https://x.test/path'`);
    expect(r.url).toBe("https://x.test/path");
  });

  it("strips query params and surfaces them separately", () => {
    const r = parseCurlCommand(`curl 'https://x.test/path?a=1&b=2'`);
    expect(r.url).toBe("https://x.test/path");
    expect(r.queryParams).toBe("a=1\nb=2");
  });

  it("extracts headers via -H", () => {
    const r = parseCurlCommand(
      `curl https://x.test -H "Authorization: Bearer sk-1" -H "X-Foo: bar"`,
    );
    expect(r.headers["authorization"].value).toBe("Bearer sk-1");
    expect(r.headers["x-foo"].value).toBe("bar");
  });

  it("extracts JSON body via -d single-quoted", () => {
    const r = parseCurlCommand(
      `curl https://x.test -d '{"model":"m","messages":[]}'`,
    );
    expect(r.body).toEqual({ model: "m", messages: [] });
  });

  it("extracts JSON body via --data-raw double-quoted", () => {
    const r = parseCurlCommand(
      `curl https://x.test --data-raw "{\\"a\\":1}"`,
    );
    expect(r.body).toEqual({ a: 1 });
  });

  it("supports backslash-newline continuations", () => {
    const r = parseCurlCommand(
      `curl http://x.test \\
  -H "Authorization: Bearer sk-1" \\
  -d '{"a":1}'`,
    );
    expect(r.url).toBe("http://x.test");
    expect(r.headers["authorization"].value).toBe("Bearer sk-1");
    expect(r.body).toEqual({ a: 1 });
  });
});

describe("detectApiType", () => {
  it("detects images by URL", () => {
    expect(detectApiType("https://x/v1/images/generations", null)).toBe("images");
  });
  it("detects embeddings by URL", () => {
    expect(detectApiType("https://x/v1/embeddings", null)).toBe("embeddings");
  });
  it("detects rerank by URL", () => {
    expect(detectApiType("https://x/rerank", null)).toBe("rerank");
  });
  it("detects rerank by body when URL is generic", () => {
    expect(detectApiType("https://x/foo", { query: "q", texts: ["a"] })).toBe("rerank");
  });
  it("detects images by body", () => {
    expect(detectApiType("https://x/foo", { prompt: "cat" })).toBe("images");
  });
  it("detects embeddings by body", () => {
    expect(detectApiType("https://x/foo", { input: "hello" })).toBe("embeddings");
  });
  it("falls back to chat", () => {
    expect(detectApiType("https://x/foo", { messages: [] })).toBe("chat");
  });
});
