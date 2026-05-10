import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertSafeUrl } from "./ssrf-guard.js";

vi.mock("node:dns/promises", () => ({
  default: { lookup: vi.fn() },
  lookup: vi.fn(),
}));

import dns from "node:dns/promises";

describe("assertSafeUrl", () => {
  beforeEach(() => {
    vi.mocked(dns.lookup).mockReset();
  });

  it("rejects non-http(s) protocols", async () => {
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toBeInstanceOf(BadRequestException);
    await expect(assertSafeUrl("gopher://x")).rejects.toBeInstanceOf(BadRequestException);
    await expect(assertSafeUrl("ftp://x")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects AWS metadata IP by hostname", async () => {
    await expect(assertSafeUrl("http://169.254.169.254/latest")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects GCP metadata hostname", async () => {
    await expect(assertSafeUrl("http://metadata.google.internal/")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects Azure WireServer IP", async () => {
    await expect(assertSafeUrl("http://168.63.129.16/")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects domain that resolves to AWS metadata IP (DNS rebinding)", async () => {
    vi.mocked(dns.lookup).mockResolvedValueOnce({ address: "169.254.169.254", family: 4 });
    await expect(assertSafeUrl("http://attacker.example.com/")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("allows public domain", async () => {
    vi.mocked(dns.lookup).mockResolvedValueOnce({ address: "104.18.32.1", family: 4 });
    const result = await assertSafeUrl("https://api.openai.com/v1/models");
    expect(result.resolvedIp).toBe("104.18.32.1");
    expect(result.safeUrl.hostname).toBe("api.openai.com");
  });

  it("allows RFC1918 private IP (user's main use case)", async () => {
    vi.mocked(dns.lookup).mockResolvedValueOnce({ address: "10.0.5.20", family: 4 });
    await expect(assertSafeUrl("http://10.0.5.20:8000")).resolves.toBeDefined();
  });

  it("allows 127.0.0.1 loopback", async () => {
    vi.mocked(dns.lookup).mockResolvedValueOnce({ address: "127.0.0.1", family: 4 });
    await expect(assertSafeUrl("http://127.0.0.1:8000")).resolves.toBeDefined();
  });

  it("allows 192.168.x", async () => {
    vi.mocked(dns.lookup).mockResolvedValueOnce({ address: "192.168.1.50", family: 4 });
    await expect(assertSafeUrl("http://192.168.1.50:11434")).resolves.toBeDefined();
  });

  it("rejects malformed URL", async () => {
    await expect(assertSafeUrl("not a url at all")).rejects.toBeInstanceOf(BadRequestException);
  });
});
