/**
 * Parse the user-facing newline-separated `key: value` header string into a
 * Record. Same format the connection form / curl-paste flow uses for its
 * `customHeaders` field (and what `applyCurlToEndpoint` produces from a
 * pasted curl).
 *
 * Lines that are blank, commented (`#`), or missing a `:` are silently
 * skipped. Empty keys and empty values are also dropped.
 *
 * Returns `undefined` (not an empty object) when the result would be empty
 * so callers can short-circuit the merge path, e.g.
 *   `fetch(url, { headers: parseCustomHeaders(raw) })`.
 */
export function parseCustomHeaders(
  raw: string | null | undefined,
): Record<string, string> | undefined {
  if (!raw) return undefined;
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    if (key && value) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
