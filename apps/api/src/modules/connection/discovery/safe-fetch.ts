import { assertSafeUrl } from "./ssrf-guard.js";

export interface SafeFetchOptions {
  /** Bearer token. Sent as `Authorization: Bearer <key>` if present. */
  apiKey?: string;
  /**
   * Extra request headers, merged into the outgoing request. Used by Discover
   * to forward gateway routing headers (e.g. Higress `x-higress-llm-model`)
   * that probes can't infer on their own. `Authorization` from `apiKey` wins
   * over any `Authorization` in `extraHeaders`. `Accept` from defaults wins
   * unless `extraHeaders` overrides it explicitly.
   */
  extraHeaders?: Record<string, string>;
  /** Abort budget in ms. Default 5000. */
  timeoutMs?: number;
  /** Max response body size in bytes. Default 1 MiB. */
  maxBytes?: number;
  /** Max redirect hops before giving up. Default 3. */
  maxRedirects?: number;
}

const DEFAULT_TIMEOUT = 5000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;

/** Header names we never let `extraHeaders` override (security / correctness). */
const RESERVED_HEADERS = new Set(["host", "content-length", "connection"]);

/**
 * `fetch` wrapper that:
 *   - aborts after `timeoutMs` (default 5s) — defense against slow probes
 *   - enforces `maxBytes` (default 1 MiB) on the response body by streaming
 *     the read and aborting when the cumulative byte count exceeds the limit
 *     (handles chunked encoding / missing Content-Length, not just the
 *     declared-length fast path)
 *   - injects `Authorization: Bearer <apiKey>` if provided
 *   - merges `extraHeaders` (caller-supplied gateway routing headers); reserved
 *     header names (host, content-length, connection) are silently dropped
 *   - handles redirects MANUALLY and re-validates every hop via `assertSafeUrl`
 *     so a public origin can't redirect us into a private/metadata IP (SSRF).
 *     Up to `maxRedirects` hops (default 3); further redirects reject.
 */
export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  const headers: Record<string, string> = { Accept: "application/json, text/plain, */*" };
  if (opts.extraHeaders) {
    for (const [k, v] of Object.entries(opts.extraHeaders)) {
      const lower = k.toLowerCase();
      if (RESERVED_HEADERS.has(lower)) continue;
      // apiKey wins over any case variant of Authorization in extraHeaders.
      if (lower === "authorization" && opts.apiKey) continue;
      headers[k] = v;
    }
  }
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = url;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      // The first URL is already validated by the caller (DiscoveryService
      // runs assertSafeUrl on the user-supplied baseUrl). Validate every
      // subsequent hop so a redirect to 169.254.169.254 etc. is blocked here.
      if (hop > 0) await assertSafeUrl(currentUrl);

      const res = await fetch(currentUrl, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: controller.signal,
      });

      // Handle 3xx manually: pull Location, resolve relative to currentUrl, loop.
      if (res.status >= 300 && res.status < 400 && res.status !== 304) {
        const location = res.headers.get("location");
        if (!location) {
          // No Location header → treat as final response (per RFC 7231 §6.4 the
          // body may still be meaningful, but our probes don't care; return it).
          return await readWithLimit(res, maxBytes);
        }
        try {
          currentUrl = new URL(location, currentUrl).toString();
        } catch {
          throw new Error(`Invalid redirect Location: ${location}`);
        }
        // Drain the redirect body so the underlying socket can be reused.
        await res.body?.cancel().catch(() => {});
        continue;
      }

      return await readWithLimit(res, maxBytes);
    }
    throw new Error(`Too many redirects (>${maxRedirects})`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read `res.body` with a hard byte budget. The Content-Length fast path
 * rejects upfront when the server declares a too-large body. The streaming
 * path catches the case where Content-Length is missing or the server uses
 * chunked transfer encoding to smuggle a large payload past the declared-
 * length check.
 *
 * Returns a fresh `Response` wrapping the buffered bytes so callers can
 * still use `res.text()` / `res.json()` (the original body stream has been
 * consumed).
 */
async function readWithLimit(res: Response, maxBytes: number): Promise<Response> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    // Drain and reject without buffering.
    await res.body?.cancel().catch(() => {});
    throw new Error(`Response too large: ${declared} bytes > ${maxBytes}`);
  }
  if (!res.body) return res;

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`Response exceeded ${maxBytes} bytes while streaming`);
    }
    chunks.push(value);
  }

  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // Preserve status + headers so callers' `res.ok`, `res.status`,
  // `res.headers.get(...)` checks behave the same.
  return new Response(buffer, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}
