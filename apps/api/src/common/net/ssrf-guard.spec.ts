import { describe, expect, it } from "vitest";
import { extractIpv4MappedAddress, isBlockedHost, isBlockedIpv4 } from "./ssrf-guard.js";

describe("isBlockedHost — dotted-decimal + names", () => {
  it("blocks loopback / 0.0.0.0/8 / link-local(metadata) / localhost / ::1", () => {
    for (const h of [
      "127.0.0.1",
      "127.1.2.3",
      "0.0.0.0",
      "169.254.169.254",
      "localhost",
      "app.localhost",
      "::1",
      "metadata.google.internal",
    ]) {
      expect(isBlockedHost(h)).toBe(true);
    }
  });

  it("blocks RFC1918 + CGNAT by default, allows them with allowPrivateNetwork", () => {
    for (const h of ["10.0.0.5", "192.168.1.1", "172.16.0.1", "100.64.0.1"]) {
      expect(isBlockedHost(h)).toBe(true);
      expect(isBlockedHost(h, { allowPrivateNetwork: true })).toBe(false);
    }
    // Loopback/metadata stay blocked even with allowPrivateNetwork.
    expect(isBlockedHost("127.0.0.1", { allowPrivateNetwork: true })).toBe(true);
    expect(isBlockedHost("169.254.169.254", { allowPrivateNetwork: true })).toBe(true);
  });

  it("allows ordinary public hosts", () => {
    for (const h of ["example.com", "8.8.8.8", "1.1.1.1"]) {
      expect(isBlockedHost(h)).toBe(false);
    }
  });
});

// The security guarantee gemini-code-assist flagged: alternative IPv4 notations
// (decimal / hex / octal / short) can't smuggle a loopback/private address past
// the dotted-decimal regex, because BOTH callers pass `new URL(url).hostname`,
// which canonicalizes them first — and `fetch` dials that same normalized host.
describe("isBlockedHost — alternative IPv4 notations are canonicalized by new URL() then blocked", () => {
  const bypassAttempts = [
    "0x7f000001", // hex integer
    "0x7f.0.0.1", // hex octet
    "2130706433", // decimal integer
    "0177.0.0.1", // octal octet
    "127.1", // short form
    "127.0.1", // short form
  ];

  it("every alt-notation for 127.0.0.1 normalizes to a blocked host", () => {
    for (const attempt of bypassAttempts) {
      const hostname = new URL(`http://${attempt}/`).hostname;
      expect(hostname).toBe("127.0.0.1");
      expect(isBlockedHost(hostname)).toBe(true);
    }
  });
});

describe("extractIpv4MappedAddress + IPv4-mapped IPv6 blocking", () => {
  it("resolves ::ffff:a.b.c.d and ::ffff:XXXX:YYYY, blocking mapped loopback", () => {
    expect(extractIpv4MappedAddress("::ffff:127.0.0.1")).toEqual([127, 0, 0, 1]);
    expect(extractIpv4MappedAddress("::ffff:7f00:0001")).toEqual([127, 0, 0, 1]);
    expect(extractIpv4MappedAddress("example.com")).toBeNull();
    expect(isBlockedHost("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedHost("[::ffff:7f00:0001]")).toBe(true);
  });
});

describe("isBlockedIpv4 ranges", () => {
  it("always-blocked vs private-gated", () => {
    expect(isBlockedIpv4(127, 0)).toBe(true);
    expect(isBlockedIpv4(0, 0)).toBe(true);
    expect(isBlockedIpv4(169, 254)).toBe(true);
    expect(isBlockedIpv4(10, 0)).toBe(true);
    expect(isBlockedIpv4(10, 0, true)).toBe(false);
    expect(isBlockedIpv4(8, 8)).toBe(false);
  });
});
