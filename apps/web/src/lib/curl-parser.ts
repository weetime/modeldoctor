export interface ParsedCurl {
  url: string;
  headers: Record<string, { originalKey: string; value: string }>;
  body: Record<string, unknown> | null;
  queryParams: string;
}

export type ApiType = "chat" | "embeddings" | "rerank" | "images" | "chat-vision" | "chat-audio";

export function parseCurlCommand(input: string): ParsedCurl {
  const result: ParsedCurl = {
    url: "",
    headers: {},
    body: null,
    queryParams: "",
  };
  const cmd = input
    .replace(/\\\s*\n/g, " ")
    .trim()
    .replace(/^curl\s+/, "");

  const urlMatch = cmd.match(/(?:^|\s)(['"]?)(https?:\/\/[^\s'"]+)\1/);
  if (urlMatch) result.url = urlMatch[2];

  if (result.url) {
    try {
      const u = new URL(result.url);
      if (u.search) {
        const parts: string[] = [];
        u.searchParams.forEach((v, k) => parts.push(`${k}=${v}`));
        result.queryParams = parts.join("\n");
        u.search = "";
        result.url = u.toString().replace(/\/$/, (m) => (result.url.endsWith("/") ? m : ""));
      }
    } catch {
      /* leave as-is */
    }
  }

  const hRe = /(?:-H|--header)\s+['"]([^'"]+)['"]/g;
  for (let m = hRe.exec(cmd); m !== null; m = hRe.exec(cmd)) {
    const colon = m[1].indexOf(":");
    if (colon > 0) {
      const key = m[1].slice(0, colon).trim();
      const value = m[1].slice(colon + 1).trim();
      result.headers[key.toLowerCase()] = { originalKey: key, value };
    }
  }

  const bodySingle = cmd.match(/(?:-d|--data-raw|--data)\s+'([\s\S]*?)(?:(?<!\\)')/);
  if (bodySingle) {
    try {
      result.body = JSON.parse(bodySingle[1]);
    } catch {
      try {
        result.body = JSON.parse(bodySingle[1].replace(/\\'/g, "'"));
      } catch {
        /* swallow */
      }
    }
  }
  if (!result.body) {
    const bodyDouble = cmd.match(/(?:-d|--data-raw|--data)\s+"([\s\S]*?)(?:(?<!\\)")/);
    if (bodyDouble) {
      try {
        result.body = JSON.parse(bodyDouble[1].replace(/\\"/g, '"'));
      } catch {
        /* swallow */
      }
    }
  }

  return result;
}

/**
 * Strip OpenAI-compatible URL path tails so `apiBaseUrl` is the canonical
 * origin (scheme://host[:port][/proxy-prefix]) — matches what guidellm
 * expects as `--target` and what LoadTest/E2E will append paths to.
 *
 * Idempotent: applying twice yields the same result. Safe to call at
 * curl-paste time AND at form submission as defense-in-depth.
 */
export function toApiBaseUrl(url: string): string {
  return url
    .replace(
      /\/v1\/(chat\/completions|completions|embeddings|rerank|images\/generations|audio\/transcriptions)\/?$/,
      "",
    )
    .replace(
      /\/(chat\/completions|completions|embeddings|rerank|images\/generations|audio\/transcriptions)\/?$/,
      "",
    )
    .replace(/\/v1\/?$/, "")
    .replace(/\/$/, "");
}

export function detectApiType(url: string, body: Record<string, unknown> | null): ApiType {
  if (url.includes("/images/generations")) return "images";
  if (url.includes("/embeddings")) return "embeddings";
  if (url.includes("/rerank")) return "rerank";
  if (body) {
    if ("query" in body && "texts" in body) return "rerank";
    if ("prompt" in body && !("messages" in body)) return "images";
    if ("input" in body && !("messages" in body)) return "embeddings";
  }
  return "chat";
}
