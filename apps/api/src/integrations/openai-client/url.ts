export function parseHeaderLines(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s || !s.trim()) return out;
  for (const rawLine of s.split("\n").map((l) => l.trim())) {
    if (!rawLine || !rawLine.includes(":")) continue;
    const idx = rawLine.indexOf(":");
    out[rawLine.slice(0, idx).trim()] = rawLine.slice(idx + 1).trim();
  }
  return out;
}

export function parseQueryLines(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s || !s.trim()) return out;
  for (const rawLine of s.split("\n").map((l) => l.trim())) {
    if (!rawLine || !rawLine.includes("=")) continue;
    const idx = rawLine.indexOf("=");
    const k = rawLine.slice(0, idx).trim();
    if (!k) continue;
    out[k] = rawLine.slice(idx + 1).trim();
  }
  return out;
}

export function buildHeaders(
  apiKey: string,
  customHeaders: string | undefined,
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...parseHeaderLines(customHeaders),
  };
}

export interface BuildUrlInput {
  apiBaseUrl: string;
  defaultPath: string;
  pathOverride?: string;
  queryParams?: string;
}

export function buildUrl({
  apiBaseUrl,
  defaultPath,
  pathOverride,
  queryParams,
}: BuildUrlInput): string {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const rawPath = pathOverride ?? defaultPath;
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  let url = base + path;
  const qp = parseQueryLines(queryParams);
  const qpKeys = Object.keys(qp);
  if (qpKeys.length > 0) {
    const search = new URLSearchParams();
    for (const k of qpKeys) search.set(k, qp[k]);
    url += (url.includes("?") ? "&" : "?") + search.toString();
  }
  return url;
}
