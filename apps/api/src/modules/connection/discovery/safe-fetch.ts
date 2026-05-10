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
}

const DEFAULT_TIMEOUT = 5000;
const DEFAULT_MAX_BYTES = 1024 * 1024;

/** Header names we never let `extraHeaders` override (security / correctness). */
const RESERVED_HEADERS = new Set(["host", "content-length", "connection"]);

/**
 * `fetch` wrapper that:
 *   - aborts after `timeoutMs` (default 5s) — defense against slow probes
 *   - rejects when Content-Length declares a body bigger than `maxBytes` (default 1 MiB)
 *   - injects `Authorization: Bearer <apiKey>` if provided
 *   - merges `extraHeaders` (caller-supplied gateway routing headers); reserved
 *     header names (host, content-length, connection) are silently dropped
 *   - leaves redirect handling to the caller (caller must use `redirect: "manual"` if they
 *     want to re-validate each hop; safeFetch defaults to `follow` for simple use)
 *
 * Note: streaming truncation (reject AFTER reading >maxBytes when Content-Length is missing)
 * is intentionally NOT implemented in V1 — most upstream `/metrics` and `/v1/models`
 * responses send Content-Length. If a malicious endpoint omits it and streams gigabytes,
 * we'll be cut off by `timeoutMs` first.
 */
export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

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
    const res = await fetch(url, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) {
      throw new Error(`Response too large: ${declared} bytes > ${maxBytes}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}
