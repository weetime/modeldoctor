import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatZodError } from "./format-zod-error.js";

describe("formatZodError", () => {
  it("formats a single missing-field issue", () => {
    const result = z.object({ rateType: z.string() }).safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatZodError(result.error)).toBe("rateType: Required");
    }
  });

  it("joins multiple issues with semicolons", () => {
    const result = z.object({ a: z.string(), b: z.number() }).safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const out = formatZodError(result.error);
      expect(out).toContain("a: Required");
      expect(out).toContain("b: Required");
      expect(out.includes(";")).toBe(true);
    }
  });

  it("uses (root) for top-level type errors", () => {
    const result = z.string().safeParse(123);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatZodError(result.error)).toMatch(/^\(root\):/);
    }
  });

  it("renders nested paths with dots", () => {
    const result = z.object({ outer: z.object({ inner: z.string() }) }).safeParse({ outer: {} });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatZodError(result.error)).toBe("outer.inner: Required");
    }
  });
});
