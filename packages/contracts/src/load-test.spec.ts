import { describe, expect, it } from "vitest";
import { ApiTypeSchema, loadTestApiTypePath } from "./load-test";

describe("loadTestApiTypePath", () => {
  it("maps chat-family types to /v1/chat/completions", () => {
    expect(loadTestApiTypePath("chat")).toBe("/v1/chat/completions");
    expect(loadTestApiTypePath("chat-vision")).toBe("/v1/chat/completions");
    expect(loadTestApiTypePath("chat-audio")).toBe("/v1/chat/completions");
  });

  it("maps embeddings to /v1/embeddings", () => {
    expect(loadTestApiTypePath("embeddings")).toBe("/v1/embeddings");
  });

  it("maps rerank to /v1/rerank", () => {
    expect(loadTestApiTypePath("rerank")).toBe("/v1/rerank");
  });

  it("maps images to /v1/images/generations", () => {
    expect(loadTestApiTypePath("images")).toBe("/v1/images/generations");
  });

  it("type union exhaustively covered", () => {
    // Derive from the schema so adding a new variant to ApiTypeSchema
    // automatically expands this test (rather than silently passing
    // against a stale string-literal subset).
    for (const t of ApiTypeSchema.options) {
      expect(typeof loadTestApiTypePath(t)).toBe("string");
      expect(loadTestApiTypePath(t).startsWith("/v1/")).toBe(true);
    }
  });
});
