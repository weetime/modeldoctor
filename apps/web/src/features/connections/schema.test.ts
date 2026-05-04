import { describe, expect, it } from "vitest";
import { connectionInputEditSchema, connectionInputSchema } from "./schema";

describe("connectionInputSchema", () => {
  const valid = {
    name: "prod-vllm",
    apiBaseUrl: "http://10.0.0.1:8000",
    apiKey: "sk-abc",
    model: "qwen-2.5-7b",
    customHeaders: "",
    queryParams: "",
    tokenizerHfId: "",
    category: "chat" as const,
  };

  it("accepts a valid input", () => {
    expect(connectionInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty name", () => {
    const r = connectionInputSchema.safeParse({ ...valid, name: " " });
    expect(r.success).toBe(false);
  });

  it("rejects invalid URL", () => {
    const r = connectionInputSchema.safeParse({
      ...valid,
      apiBaseUrl: "not-a-url",
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty apiKey", () => {
    const r = connectionInputSchema.safeParse({ ...valid, apiKey: "" });
    expect(r.success).toBe(false);
  });

  it("rejects apiKey with control characters (e.g. newline from paste)", () => {
    const r = connectionInputSchema.safeParse({ ...valid, apiKey: "sk-test\nwith-newline" });
    expect(r.success).toBe(false);
  });

  it("rejects apiKey with leading whitespace", () => {
    const r = connectionInputSchema.safeParse({ ...valid, apiKey: " sk-test" });
    expect(r.success).toBe(false);
  });

  it("rejects apiKey with trailing whitespace", () => {
    const r = connectionInputSchema.safeParse({ ...valid, apiKey: "sk-test " });
    expect(r.success).toBe(false);
  });

  it("accepts apiKey with shell metacharacters (POSIX-safe)", () => {
    const r = connectionInputSchema.safeParse({
      ...valid,
      apiKey: 'sk-test$(rm)`backtick`"quote',
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty model", () => {
    const r = connectionInputSchema.safeParse({ ...valid, model: "" });
    expect(r.success).toBe(false);
  });

  it("normalizes name by trimming", () => {
    const r = connectionInputSchema.safeParse({
      ...valid,
      name: "  staging  ",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("staging");
  });
});

describe("connectionInputSchema (category + tags)", () => {
  const baseInput = {
    name: "n",
    apiBaseUrl: "http://x",
    apiKey: "k",
    model: "m",
    customHeaders: "",
    queryParams: "",
    tokenizerHfId: "",
  };

  it("requires a category", () => {
    expect(() => connectionInputSchema.parse({ ...baseInput, tags: [] })).toThrow();
  });

  it("rejects an unknown category", () => {
    expect(() =>
      connectionInputSchema.parse({ ...baseInput, category: "video", tags: [] }),
    ).toThrow();
  });

  it("trims and dedupes tags", () => {
    const out = connectionInputSchema.parse({
      ...baseInput,
      category: "chat",
      tags: ["  vLLM  ", "vLLM", "production", ""],
    });
    expect(out.tags).toEqual(["vLLM", "production"]);
  });

  it("defaults tags to an empty array when omitted", () => {
    const out = connectionInputSchema.parse({ ...baseInput, category: "chat" });
    expect(out.tags).toEqual([]);
  });
});

describe("connectionInputEditSchema apiKey refine (edit-mode)", () => {
  const validBaseInput = {
    name: "prod-vllm",
    apiBaseUrl: "http://10.0.0.1:8000",
    apiKey: "sk-abc",
    model: "qwen-2.5-7b",
    customHeaders: "",
    queryParams: "",
    tokenizerHfId: "",
    category: "chat" as const,
  };

  it("accepts empty apiKey (no-reset signal)", () => {
    const result = connectionInputEditSchema.safeParse({
      ...validBaseInput,
      apiKey: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects edit-mode apiKey with control characters when non-empty", () => {
    const result = connectionInputEditSchema.safeParse({
      ...validBaseInput,
      apiKey: "sk-test\nwith-newline",
    });
    expect(result.success).toBe(false);
  });

  it("rejects edit-mode apiKey with leading whitespace when non-empty", () => {
    const result = connectionInputEditSchema.safeParse({
      ...validBaseInput,
      apiKey: " sk-test",
    });
    expect(result.success).toBe(false);
  });

  it("accepts edit-mode apiKey with shell metacharacters (POSIX expansion is safe)", () => {
    const result = connectionInputEditSchema.safeParse({
      ...validBaseInput,
      apiKey: 'sk-test$(rm)`backtick`"quote',
    });
    expect(result.success).toBe(true);
  });
});
