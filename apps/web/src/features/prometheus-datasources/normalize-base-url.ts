// Canonical form for comparing Prometheus base URLs in the UI (e.g. the
// Discover→register CTA's dup-check). Normalization:
// - protocol + host lowercased (HTTP scheme/host are case-insensitive)
// - trailing slashes on the path stripped
// - path case preserved (HTTP path is case-sensitive per RFC 3986)
// - query + hash preserved if present
// When the input is not a parseable URL we still trim and strip any
// trailing slash so the dup-check degrades to "literal equality after a
// light wash" rather than missing trivially obvious matches.
export function normalizeBaseUrl(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${path}${u.search}${u.hash}`;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}
