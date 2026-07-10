/**
 * Shared SSRF host guard. Blocks loopback / private / link-local / CGNAT /
 * metadata hosts for any server-initiated outbound request the user can
 * point at an arbitrary URL (the `http_get` built-in tool, the MCP client).
 * This is a literal-hostname/IP check (no DNS resolution) — good enough to
 * stop the obvious classes of abuse (localhost, RFC1918 private ranges,
 * 0.0.0.0/8, CGNAT 100.64.0.0/10, link-local incl. the 169.254.169.254 cloud
 * metadata endpoint, IPv6 loopback/unique-local/link-local).
 *
 * Originally written for `builtin-tools.ts`'s `http_get` tool; extracted here
 * so `McpClientService` can enforce the identical policy before connecting
 * to a user-supplied MCP server URL.
 */

/**
 * Options controlling how much of the private address space is blocked.
 *
 * `allowPrivateNetwork` — when true, RFC1918 (10/8, 172.16/12, 192.168/16),
 * CGNAT (100.64/10), and IPv6 unique-local (fc00::/7) are ALLOWED. This is for
 * server URLs the authenticated admin *deliberately registers* against their
 * own private cluster (the MCP client) in a self-hosted deployment — those
 * services legitimately live on private IPs. Even with this flag the
 * universally-dangerous targets stay blocked: `0.0.0.0/8`, loopback (127/8,
 * localhost, ::1), and link-local incl. the 169.254.169.254 cloud-metadata
 * endpoint / fe80::/10. The default (false) blocks the whole private space and
 * is used by the model-driven `http_get` built-in tool, whose URL is arbitrary
 * and attacker-influencable.
 */
export interface SsrfGuardOptions {
  allowPrivateNetwork?: boolean;
}

/**
 * Returns true if `a.b.c.d` falls in a blocked IPv4 range. Always-blocked:
 * loopback (127/8), 0.0.0.0/8, link-local incl. the 169.254.169.254 cloud
 * metadata endpoint (169.254/16). Private ranges (RFC1918 + CGNAT 100.64/10)
 * are blocked only when `allowPrivateNetwork` is false. Shared by the
 * dotted-decimal check and the IPv4-mapped-IPv6 check below so both paths
 * enforce identical ranges.
 */
export function isBlockedIpv4(a: number, b: number, allowPrivateNetwork = false): boolean {
  // Always blocked — never a legitimate outbound target.
  if (a === 0) return true; // 0.0.0.0/8 ("this" network / unspecified)
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (incl. 169.254.169.254 metadata)
  // Private ranges — allowed for deliberately-registered self-hosted endpoints.
  if (allowPrivateNetwork) return false;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

/**
 * Extracts the embedded IPv4 address from an IPv4-mapped IPv6 literal, in
 * either textual form Node's URL parser can produce:
 *   - dotted tail:  ::ffff:a.b.c.d
 *   - hex-group:    ::ffff:XXXX:YYYY  (each group is 16 bits -> a.b.c.d
 *                   where a.b = XXXX as two bytes, c.d = YYYY as two bytes)
 * Returns null if `host` isn't an IPv4-mapped IPv6 literal.
 */
export function extractIpv4MappedAddress(host: string): [number, number, number, number] | null {
  const dottedMatch = host.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i);
  if (dottedMatch) {
    const [a, b, c, d] = dottedMatch.slice(1).map(Number);
    return [a, b, c, d];
  }

  const hexMatch = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hexMatch) {
    const g1 = Number.parseInt(hexMatch[1], 16);
    const g2 = Number.parseInt(hexMatch[2], 16);
    return [(g1 >> 8) & 0xff, g1 & 0xff, (g2 >> 8) & 0xff, g2 & 0xff];
  }

  return null;
}

/**
 * `hostname` MUST be a WHATWG-URL-parsed host (i.e. `new URL(userUrl).hostname`
 * — how BOTH callers derive it: `http_get`'s `parsed.hostname` and the MCP
 * client's `assertServerUrlAllowed`). That parser CANONICALIZES every
 * alternative IPv4 notation an attacker could use to smuggle a loopback/private
 * address past the dotted-decimal regex below — decimal (`2130706433`), hex
 * (`0x7f000001`, `0x7f.0.0.1`), octal (`0177.0.0.1`), and short forms (`127.1`)
 * all normalize to `127.0.0.1` before they reach here (covered in the spec).
 * The same parser backs `fetch` / the MCP transport, so what we check is
 * exactly what gets dialed — no parse-vs-dial discrepancy. Passing a RAW,
 * unparsed host string would defeat this; don't.
 */
export function isBlockedHost(hostname: string, options: SsrfGuardOptions = {}): boolean {
  const allowPrivateNetwork = options.allowPrivateNetwork ?? false;
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  // IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:XXXX:YYYY) — resolve to the
  // embedded IPv4 address and apply the same range checks BEFORE any other
  // check, since this literal wouldn't otherwise match the dotted-decimal
  // regex below.
  const mapped = extractIpv4MappedAddress(host);
  if (mapped && isBlockedIpv4(mapped[0], mapped[1], allowPrivateNetwork)) return true;

  // Always blocked regardless of allowPrivateNetwork.
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0") return true;
  if (host === "::1" || host === "::") return true;
  if (host === "metadata.google.internal") return true;
  // IPv6 link-local (fe80::/10) — includes the metadata endpoint's v6 form.
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;

  // IPv6 unique-local (fc00::/7 -> first byte 0xfc or 0xfd) — the v6 RFC1918
  // equivalent, so it follows allowPrivateNetwork.
  if (!allowPrivateNetwork && /^(fc|fd)[0-9a-f]{0,2}:/i.test(host)) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (isBlockedIpv4(a, b, allowPrivateNetwork)) return true;
  }

  return false;
}
