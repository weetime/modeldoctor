// apps/api/src/modules/alerts/prometheus-fetcher.guard.spec.ts
import { describe, expect, it } from "vitest";
import {
  evaluateUrl,
  isPrivateOrLoopback,
  type Resolver,
  type SsrfGuardConfig,
} from "./prometheus-fetcher.guard.js";

const noResolver: Resolver = async () => {
  throw new Error("resolver should not be called");
};
const fixedResolver =
  (ips: string[]): Resolver =>
  async () =>
    ips;
const failingResolver: Resolver = async () => {
  throw new Error("ENOTFOUND prom.lab");
};

const CONFIG_PERMISSIVE: SsrfGuardConfig = { blockPrivate: false, allowHosts: null };
const CONFIG_BLOCK: SsrfGuardConfig = { blockPrivate: true, allowHosts: null };
const CONFIG_ALLOW_LIST = (hosts: string[]): SsrfGuardConfig => ({
  blockPrivate: true, // ignored when allowHosts non-empty
  allowHosts: hosts,
});

describe("isPrivateOrLoopback (IPv4)", () => {
  it.each([
    ["10.0.0.1", true],
    ["10.255.255.255", true],
    ["172.15.0.1", false],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["172.32.0.1", false],
    ["192.168.1.1", true],
    ["192.169.1.1", false],
    ["127.0.0.1", true],
    ["127.255.255.255", true],
    ["169.254.169.254", true],
    ["0.0.0.0", true],
    // RFC 6598 CGNAT / shared address space
    ["100.63.255.255", false],
    ["100.64.0.1", true],
    ["100.127.255.255", true],
    ["100.128.0.1", false],
    // RFC 2544 benchmark testing
    ["198.17.255.255", false],
    ["198.18.0.1", true],
    ["198.19.255.255", true],
    ["198.20.0.1", false],
    // Multicast + reserved + broadcast (>= 224.0.0.0)
    ["223.255.255.255", false],
    ["224.0.0.1", true],
    ["239.255.255.255", true],
    ["240.0.0.1", true],
    ["255.255.255.255", true],
    ["8.8.8.8", false],
    ["1.1.1.1", false],
  ] as const)("%s → %s", (ip, expected) => {
    expect(isPrivateOrLoopback(ip)).toBe(expected);
  });
});

describe("isPrivateOrLoopback (IPv6)", () => {
  it.each([
    ["::1", true],
    ["::", true], // unspecified address — some stacks route to localhost
    ["fc00::1", true],
    ["fd12:3456:789a::1", true],
    ["fe80::1", true],
    ["::ffff:10.0.0.1", true], // IPv4-mapped private
    ["::ffff:8.8.8.8", false], // IPv4-mapped public
    ["2001:db8::1", false], // documentation range, treated as public for our purposes
    ["2606:4700:4700::1111", false], // Cloudflare DNS, public
  ] as const)("%s → %s", (ip, expected) => {
    expect(isPrivateOrLoopback(ip)).toBe(expected);
  });
});

describe("isPrivateOrLoopback rejects non-IPs", () => {
  it("returns false for hostnames", () => {
    expect(isPrivateOrLoopback("prom.lab")).toBe(false);
  });
  it("returns false for garbage", () => {
    expect(isPrivateOrLoopback("not an ip")).toBe(false);
  });
});

describe("evaluateUrl — permissive default (no allow-list, blockPrivate=false)", () => {
  it("allows any public host without DNS lookup", async () => {
    const v = await evaluateUrl(
      new URL("http://public.example.com"),
      CONFIG_PERMISSIVE,
      noResolver,
    );
    expect(v).toEqual({ ok: true });
  });
  it("allows a private IP literal", async () => {
    const v = await evaluateUrl(new URL("http://10.0.0.5:9090"), CONFIG_PERMISSIVE, noResolver);
    expect(v).toEqual({ ok: true });
  });
});

describe("evaluateUrl — blockPrivate=true (opt-in)", () => {
  it("blocks a private IP literal", async () => {
    const v = await evaluateUrl(new URL("http://10.0.0.5:9090"), CONFIG_BLOCK, noResolver);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/private\/loopback/);
  });
  it("blocks loopback", async () => {
    const v = await evaluateUrl(new URL("http://127.0.0.1:9090"), CONFIG_BLOCK, noResolver);
    expect(v.ok).toBe(false);
  });
  it("blocks cloud metadata endpoint", async () => {
    const v = await evaluateUrl(
      new URL("http://169.254.169.254/latest/meta-data/"),
      CONFIG_BLOCK,
      noResolver,
    );
    expect(v.ok).toBe(false);
  });
  it("allows a public IP literal", async () => {
    const v = await evaluateUrl(new URL("http://8.8.8.8:9090"), CONFIG_BLOCK, noResolver);
    expect(v).toEqual({ ok: true });
  });
  it("resolves hostname and blocks when it points at a private IP", async () => {
    const v = await evaluateUrl(
      new URL("http://prom.lab:9090"),
      CONFIG_BLOCK,
      fixedResolver(["10.0.0.5"]),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/prom\.lab.*10\.0\.0\.5/);
  });
  it("resolves hostname and allows when it points at a public IP", async () => {
    const v = await evaluateUrl(
      new URL("http://prom.example.com:9090"),
      CONFIG_BLOCK,
      fixedResolver(["1.2.3.4"]),
    );
    expect(v).toEqual({ ok: true });
  });
  it("blocks when ANY resolved IP is private (split-horizon DNS)", async () => {
    const v = await evaluateUrl(
      new URL("http://prom.example.com:9090"),
      CONFIG_BLOCK,
      fixedResolver(["1.2.3.4", "10.0.0.5"]),
    );
    expect(v.ok).toBe(false);
  });
  it("blocks when resolver returns empty array", async () => {
    const v = await evaluateUrl(
      new URL("http://no-such-host.example"),
      CONFIG_BLOCK,
      fixedResolver([]),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/no records/);
  });
  it("blocks when resolver throws (fail-closed)", async () => {
    const v = await evaluateUrl(new URL("http://prom.lab"), CONFIG_BLOCK, failingResolver);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/dns lookup failed/);
  });
});

describe("evaluateUrl — allowHosts is the policy when set", () => {
  it("allows a host in the list (case-insensitive)", async () => {
    const v = await evaluateUrl(
      new URL("http://PROM.lab:9090"),
      CONFIG_ALLOW_LIST(["prom.lab", "prom2.lab"]),
      noResolver,
    );
    expect(v).toEqual({ ok: true });
  });
  it("blocks a host not in the list, even on the public internet", async () => {
    const v = await evaluateUrl(
      new URL("http://public.example.com"),
      CONFIG_ALLOW_LIST(["prom.lab"]),
      noResolver,
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/not in PROMETHEUS_FETCH_ALLOW_HOSTS/);
  });
  it("allows a private IP if it's explicitly listed (overrides blockPrivate)", async () => {
    const v = await evaluateUrl(
      new URL("http://10.0.0.5:9090"),
      CONFIG_ALLOW_LIST(["10.0.0.5"]),
      noResolver,
    );
    expect(v).toEqual({ ok: true });
  });
  it("treats empty allowHosts array as 'no allow-list configured'", async () => {
    const v = await evaluateUrl(
      new URL("http://public.example.com"),
      { blockPrivate: false, allowHosts: [] },
      noResolver,
    );
    expect(v).toEqual({ ok: true });
  });
});

describe("evaluateUrl — input edge cases", () => {
  it("rejects a URL with no hostname", async () => {
    // file:// URLs have empty hostname; not actually fetchable but defensive.
    const u = new URL("file:///etc/passwd");
    const v = await evaluateUrl(u, CONFIG_BLOCK, noResolver);
    expect(v.ok).toBe(false);
  });
});
