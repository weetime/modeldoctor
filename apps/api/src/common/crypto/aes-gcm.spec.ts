import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeKey, decrypt, encrypt } from "./aes-gcm.js";

describe("aes-gcm", () => {
  const key = randomBytes(32);

  describe("decodeKey", () => {
    it("decodes a valid 32-byte base64 key", () => {
      const b64 = randomBytes(32).toString("base64");
      const out = decodeKey(b64);
      expect(out.length).toBe(32);
      expect(out.equals(Buffer.from(b64, "base64"))).toBe(true);
    });

    it("throws when the decoded key is not 32 bytes", () => {
      const tooShort = randomBytes(16).toString("base64");
      expect(() => decodeKey(tooShort)).toThrow(/32 bytes/);
    });
  });

  describe("encrypt + decrypt", () => {
    it("round-trips a UTF-8 string", () => {
      const ct = encrypt("hello, 世界", key);
      expect(decrypt(ct, key)).toBe("hello, 世界");
    });

    it("emits the v1 prefix and four colon-separated parts", () => {
      const ct = encrypt("anything", key);
      const parts = ct.split(":");
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe("v1");
    });

    it("produces different ciphertexts for the same plaintext (random IV)", () => {
      const a = encrypt("same input", key);
      const b = encrypt("same input", key);
      expect(a).not.toBe(b);
    });

    it("throws when decrypting with the wrong key", () => {
      const ct = encrypt("secret", key);
      const otherKey = randomBytes(32);
      expect(() => decrypt(ct, otherKey)).toThrow();
    });

    it("throws when the ciphertext is tampered with", () => {
      const ct = encrypt("secret", key);
      // Flip a byte in the ciphertext segment (last colon-separated part)
      const parts = ct.split(":");
      const ctBytes = Buffer.from(parts[3], "base64");
      ctBytes[0] = ctBytes[0] ^ 0x01;
      parts[3] = ctBytes.toString("base64");
      const tampered = parts.join(":");
      expect(() => decrypt(tampered, key)).toThrow();
    });

    it("throws when the auth tag is tampered with", () => {
      const ct = encrypt("secret", key);
      const parts = ct.split(":");
      const tagBytes = Buffer.from(parts[2], "base64");
      tagBytes[0] = tagBytes[0] ^ 0x01;
      parts[2] = tagBytes.toString("base64");
      const tampered = parts.join(":");
      expect(() => decrypt(tampered, key)).toThrow();
    });

    it("rejects an unknown version prefix", () => {
      const ct = encrypt("secret", key);
      const tampered = ct.replace(/^v1:/, "v2:");
      expect(() => decrypt(tampered, key)).toThrow(/version/);
    });

    it("rejects malformed input (not 4 parts)", () => {
      expect(() => decrypt("v1:not-enough-parts", key)).toThrow(/Malformed/);
    });

    it("encrypt rejects a wrong-length key", () => {
      const badKey = randomBytes(16);
      expect(() => encrypt("x", badKey)).toThrow(/32 bytes/);
    });

    it("decrypt rejects a wrong-length key", () => {
      const ct = encrypt("x", key);
      const badKey = randomBytes(16);
      expect(() => decrypt(ct, badKey)).toThrow(/32 bytes/);
    });
  });
});
