/**
 * Rerank probe — Cohere / OpenAI-compat shape.
 *
 * POST {apiBaseUrl}{pathOverride ?? "/v1/rerank"}
 * Body: { query, documents: [...], model?, top_n? }
 * Response: { results: [{ index, relevance_score }] }
 */
import type { ProbeCtx, ProbeResult } from "./index.js";

const TEST_QUERY = "What is the fastest mammal?";
const TEST_DOCS = [
  "Cheetahs are the fastest land animals.",
  "The blue whale is the largest animal.",
  "Pizza was invented in Naples.",
];

interface CohereRerankResponse {
  results?: { index?: number; relevance_score?: number }[];
}

export async function runRerankCohereProbe({
  apiBaseUrl,
  apiKey,
  model,
  extraHeaders = {},
  pathOverride,
}: ProbeCtx): Promise<ProbeResult> {
  const path = pathOverride ?? "/v1/rerank";
  const targetUrl = `${apiBaseUrl}${path}`;
  const body = { model, query: TEST_QUERY, documents: TEST_DOCS };

  const t0 = Date.now();
  const res = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - t0;
  const rawText = await res.text();

  let parsed: CohereRerankResponse;
  try {
    parsed = JSON.parse(rawText) as CohereRerankResponse;
  } catch {
    return {
      pass: false,
      latencyMs,
      checks: [{ name: "HTTP 200 + JSON body", pass: false, info: `status=${res.status}` }],
      details: { error: `status=${res.status} body=${rawText.slice(0, 500)}` },
    };
  }

  const results = parsed.results
    ?.filter((r) => typeof r.index === "number" && typeof r.relevance_score === "number")
    .map((r) => ({ index: r.index as number, score: r.relevance_score as number }));

  const checks = [
    { name: "HTTP status 200", pass: res.status === 200, info: String(res.status) },
    {
      name: "results[] populated",
      pass: !!results && results.length > 0,
      info: `${results?.length ?? 0} entries`,
    },
    {
      name: "At least one entry per input",
      pass: !!results && results.length === TEST_DOCS.length,
      info: `${results?.length ?? 0} / ${TEST_DOCS.length}`,
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
