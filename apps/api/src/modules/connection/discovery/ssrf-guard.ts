import dns from "node:dns/promises";
import { BadRequestException } from "@nestjs/common";

const PROTOCOL_WHITELIST = new Set(["http:", "https:"]);

/**
 * Cloud metadata service hosts — never legitimate to discover, always blocked.
 * Hostname-form (e.g. metadata.google.internal) AND resolved-IP-form must be checked
 * to defend against DNS rebinding.
 */
const CLOUD_METADATA_HOSTS = new Set([
  "169.254.169.254", // AWS, OpenStack, Alibaba ECS
  "metadata.google.internal", // GCP (resolves to 169.254.169.254 anyway, but block by name too)
  "168.63.129.16", // Azure WireServer
  "100.100.100.200", // Alibaba ECS metadata
]);

export interface SafeUrlResult {
  /** The original URL after parsing. Caller should use this rather than the input. */
  safeUrl: URL;
  /** The IP `dns.lookup` resolved the hostname to. Useful for redirect-chain re-validation. */
  resolvedIp: string;
}

/**
 * Validate a user-supplied URL for SSRF safety per Roadmap A's "hybrid policy D":
 *
 *   ALLOW:  public IPs, RFC1918 private (10/8, 172.16/12, 192.168/16), loopback (127/8),
 *           link-local IPv6 (fc00::/7), the user's own internal deployments
 *   BLOCK:  non-http(s) protocols, hardcoded cloud-metadata hosts (also as resolved IP)
 *
 * Throws BadRequestException with a short reason on any rejection.
 */
export async function assertSafeUrl(input: string): Promise<SafeUrlResult> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new BadRequestException("URL malformed");
  }

  if (!PROTOCOL_WHITELIST.has(url.protocol)) {
    throw new BadRequestException(`Protocol not allowed: ${url.protocol}`);
  }

  const hostname = url.hostname.toLowerCase();
  if (CLOUD_METADATA_HOSTS.has(hostname)) {
    throw new BadRequestException(`Cloud metadata endpoint blocked: ${hostname}`);
  }

  let resolvedIp: string;
  try {
    const r = await dns.lookup(hostname);
    resolvedIp = r.address;
  } catch {
    throw new BadRequestException(`DNS resolution failed for ${hostname}`);
  }

  if (CLOUD_METADATA_HOSTS.has(resolvedIp)) {
    throw new BadRequestException(`Resolved IP blocked: ${resolvedIp}`);
  }

  return { safeUrl: url, resolvedIp };
}
