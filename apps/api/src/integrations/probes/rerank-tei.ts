/**
 * Rerank probe — TEI native shape.
 *
 * POST {apiBaseUrl}{pathOverride ?? "/rerank"}
 * Body: { query, texts: [...], model? }
 * Response: [{ index, score }] sorted by score desc.
 */
import { buildHeaders, buildUrl } from "../openai-client/index.js";
import type { ProbeCtx, ProbeResult } from "./index.js";

const TEST_QUERY = "What is the fastest mammal?";
const TEST_TEXTS = [
  "Cheetahs are the fastest land animals.",
  "The blue whale is the largest animal.",
  "Pizza was invented in Naples.",
];

export async function runRerankTEIProbe({
  apiBaseUrl,
  apiKey,
  model,
  extraHeaders = {},
  pathOverride,
}: ProbeCtx): Promise<ProbeResult> {
  const targetUrl = buildUrl({
    apiBaseUrl,
    defaultPath: "/rerank",
    pathOverride,
  });
  const headers = {
    ...buildHeaders(apiKey, undefined),
    ...extraHeaders,
  };
  const body = { model, query: TEST_QUERY, texts: TEST_TEXTS };

  const t0 = Date.now();
  const res = await fetch(targetUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - t0;
  const rawText = await res.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      pass: false,
      latencyMs,
      checks: [{ name: "HTTP 200 + JSON body", pass: false, info: `status=${res.status}` }],
      details: { error: `status=${res.status} body=${rawText.slice(0, 500)}` },
    };
  }

  const arr =
    Array.isArray(parsed) && parsed.every((r) => typeof r === "object" && r !== null)
      ? (parsed as { index?: number; score?: number }[])
      : null;

  const results = arr
    ?.filter((r) => typeof r.index === "number" && typeof r.score === "number")
    .map((r) => ({ index: r.index as number, score: r.score as number }));

  const checks = [
    { name: "HTTP status 200", pass: res.status === 200, info: String(res.status) },
    { name: "Response is array of {index, score}", pass: !!results && results.length > 0 },
    {
      name: "At least one entry per input",
      pass: !!results && results.length === TEST_TEXTS.length,
      info: `${results?.length ?? 0} / ${TEST_TEXTS.length}`,
    },
  ];
  const pass = checks.every((c) => c.pass);

  return {
    pass,
    latencyMs,
    checks,
    details: {
      ...(results ? { rerankResults: results } : {}),
      ...(!pass ? { error: `status=${res.status} body=${rawText.slice(0, 500)}` } : {}),
    },
  };
}
