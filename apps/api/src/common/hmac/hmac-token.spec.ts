import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signCallbackToken, verifyCallbackToken } from "./hmac-token.js";

describe("hmac-token", () => {
  const secret = randomBytes(32);
  const id = "ckxxxxxxxxxxxxxxxxxxxxxxx";
  const NOW = 1_700_000_000;

  describe("signCallbackToken", () => {
    it("emits <exp>.<hex-sig> with exp = nowSeconds + ttlSeconds", () => {
      const tok = signCallbackToken(id, secret, 60, NOW);
      const [expStr, sig] = tok.split(".");
      expect(Number.parseInt(expStr, 10)).toBe(NOW + 60);
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it("produces stable output for stable inputs", () => {
      const a = signCallbackToken(id, secret, 60, NOW);
      const b = signCallbackToken(id, secret, 60, NOW);
      expect(a).toBe(b);
    });
  });

  describe("verifyCallbackToken", () => {
    it("accepts a freshly signed token", () => {
      const tok = signCallbackToken(id, secret, 60, NOW);
      expect(verifyCallbackToken(id, tok, secret, NOW + 30)).toBe(true);
    });

    it("rejects expired tokens (now > exp)", () => {
      const tok = signCallbackToken(id, secret, 60, NOW);
      expect(verifyCallbackToken(id, tok, secret, NOW + 61)).toBe(false);
    });

    it("rejects tokens signed for a different id", () => {
      const tok = signCallbackToken("other-id", secret, 60, NOW);
      expect(verifyCallbackToken(id, tok, secret, NOW + 30)).toBe(false);
    });

    it("rejects tokens signed with a different secret", () => {
      const tok = signCallbackToken(id, secret, 60, NOW);
      const other = randomBytes(32);
      expect(verifyCallbackToken(id, tok, other, NOW + 30)).toBe(false);
    });

    it("rejects malformed tokens (no dot)", () => {
      expect(verifyCallbackToken(id, "abcdef", secret, NOW)).toBe(false);
    });

    it("rejects tokens with extra dots", () => {
      expect(verifyCallbackToken(id, "1.2.3", secret, NOW)).toBe(false);
    });

    it("rejects tokens whose exp is non-numeric", () => {
      expect(verifyCallbackToken(id, "abc.deadbeef", secret, NOW)).toBe(false);
    });

    it("rejects tokens whose sig hex differs by one bit (constant-time compare)", () => {
      const tok = signCallbackToken(id, secret, 60, NOW);
      const [exp, sig] = tok.split(".");
      const tampered = `${exp}.${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`;
      expect(verifyCallbackToken(id, tampered, secret, NOW + 30)).toBe(false);
    });

    it("rejects tokens whose sig is shorter than expected (length mismatch)", () => {
      const tok = signCallbackToken(id, secret, 60, NOW);
      const [exp, sig] = tok.split(".");
      const truncated = `${exp}.${sig.slice(0, -2)}`;
      expect(verifyCallbackToken(id, truncated, secret, NOW + 30)).toBe(false);
    });
  });
});
