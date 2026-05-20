import { promises as dns } from "node:dns";
// apps/api/src/modules/alerts/prometheus-fetcher.guard.ts
import { isIP } from "node:net";

/**
 * Defense-in-depth guard for the PrometheusFetcher's outbound HTTP. The
 * datasource baseUrl is admin-supplied so the realistic threat surface is
 * compromised-admin / misconfiguration rather than untrusted input — the
 * point of these guards is to make a misconfigured allow-list or a
 * dynamic-DNS rebind blow up loudly instead of silently leaking onto
 * unexpected network segments.
 *
 * Closes #200.
 */

export interface SsrfGuardConfig {
  /**
   * When true, any URL whose host (or any DNS-resolved IP for a hostname)
   * falls in a private / loopback / link-local range is rejected. Default
   * is `false` — ModelDoctor deploys typically run Prometheus on an
   * internal LAN, and a "block by default" stance would silently break
   * existing setups on upgrade. Opt in for paranoid prod.
   */
  blockPrivate: boolean;
  /**
   * Positive allow-list of hostnames (matched case-insensitively, exact
   * string equality on `URL.hostname`). When non-empty, this list IS the
   * policy: anything outside it is blocked, AND the `blockPrivate` check
   * is bypassed (the operator made an explicit choice).
   *
   * `null` (or empty array) means "no allow-list configured" — fall
   * through to the `blockPrivate` check.
   */
  allowHosts: readonly string[] | null;
}

export type GuardVerdict = { ok: true } | { ok: false; reason: string };

/** DNS resolver injection point. Production uses `dns.promises.lookup` (all=true). */
export type Resolver = (hostname: string) => Promise<string[]>;

const defaultResolver: Resolver = async (hostname) => {
  const records = await dns.lookup(hostname, { all: true });
  return records.map((r) => r.address);
};

/**
 * Is the given IPv4/IPv6 literal in a private / loopback / link-local range?
 * Ranges per RFC 1918, RFC 4193, RFC 3927, RFC 4291.
 */
export function isPrivateOrLoopback(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
    const [a, b] = parts;
    // 10.0.0.0/8
    if (a === 10) return true;
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    // 127.0.0.0/8 (loopback)
    if (a === 127) return true;
    // 169.254.0.0/16 (link-local, includes cloud metadata 169.254.169.254)
    if (a === 169 && b === 254) return true;
    // 0.0.0.0/8 (current network — kernel-routed to localhost on Linux)
    if (a === 0) return true;
    // 100.64.0.0/10 (RFC 6598 CGNAT / shared address space)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 198.18.0.0/15 (RFC 2544 benchmark testing)
    if (a === 198 && (b === 18 || b === 19)) return true;
    // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved/class E + 255.255.255.255 broadcast
    if (a >= 224) return true;
    return false;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    // ::1 loopback, :: unspecified (some stacks route to localhost)
    if (lower === "::1" || lower === "::") return true;
    // fc00::/7 unique local
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
    // fe80::/10 link-local
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
    // IPv4-mapped IPv6: ::ffff:a.b.c.d — fall through to the IPv4 check
    const v4mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4mapped) return isPrivateOrLoopback(v4mapped[1]);
    return false;
  }
  return false; // not a valid IP literal at all — caller decides
}

/**
 * Evaluate whether the given URL is allowed to be fetched. Resolves
 * hostnames via the injected resolver so callers can mock DNS in tests.
 */
export async function evaluateUrl(
  url: URL,
  config: SsrfGuardConfig,
  resolver: Resolver = defaultResolver,
): Promise<GuardVerdict> {
  const host = url.hostname;
  if (!host) return { ok: false, reason: "missing hostname" };

  // 1. Positive allow-list takes precedence.
  if (config.allowHosts && config.allowHosts.length > 0) {
    const allow = config.allowHosts.map((h) => h.toLowerCase());
    if (allow.includes(host.toLowerCase())) return { ok: true };
    return { ok: false, reason: `host "${host}" not in PROMETHEUS_FETCH_ALLOW_HOSTS` };
  }

  // 2. Private-IP block (opt-in).
  if (!config.blockPrivate) return { ok: true };

  let ipsToCheck: string[];
  if (isIP(host)) {
    ipsToCheck = [host];
  } else {
    try {
      ipsToCheck = await resolver(host);
    } catch (e) {
      return {
        ok: false,
        reason: `dns lookup failed for "${host}": ${(e as Error).message}`,
      };
    }
  }

  if (ipsToCheck.length === 0) {
    return { ok: false, reason: `dns lookup returned no records for "${host}"` };
  }

  for (const ip of ipsToCheck) {
    if (isPrivateOrLoopback(ip)) {
      return {
        ok: false,
        reason: `host "${host}" resolves to private/loopback address ${ip}`,
      };
    }
  }

  return { ok: true };
}
