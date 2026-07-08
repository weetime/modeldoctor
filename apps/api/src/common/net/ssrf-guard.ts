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
 * Returns true if `a.b.c.d` falls in a blocked IPv4 range (loopback,
 * 0.0.0.0/8, RFC1918 private ranges, CGNAT 100.64.0.0/10, or link-local incl.
 * the 169.254.169.254 cloud metadata endpoint). Shared by the dotted-decimal
 * check and the IPv4-mapped-IPv6 check below so both paths enforce identical
 * ranges.
 */
export function isBlockedIpv4(a: number, b: number): boolean {
  if (a === 0) return true; // 0.0.0.0/8 ("this" network / unspecified)
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (incl. 169.254.169.254 metadata)
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

export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  // IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:XXXX:YYYY) — resolve to the
  // embedded IPv4 address and apply the same range checks BEFORE any other
  // check, since this literal wouldn't otherwise match the dotted-decimal
  // regex below.
  const mapped = extractIpv4MappedAddress(host);
  if (mapped && isBlockedIpv4(mapped[0], mapped[1])) return true;

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0") return true;
  if (host === "::1" || host === "::") return true;
  if (host === "metadata.google.internal") return true;

  // IPv6 unique-local (fc00::/7 -> first byte 0xfc or 0xfd)
  if (/^(fc|fd)[0-9a-f]{0,2}:/i.test(host)) return true;
  // IPv6 link-local (fe80::/10)
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (isBlockedIpv4(a, b)) return true;
  }

  return false;
}
