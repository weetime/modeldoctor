/**
 * Embeddings probe — OpenAI shape.
 *
 * POST {apiBaseUrl}{pathOverride ?? "/v1/embeddings"}
 * Body: { model, input: "..." }
 * Response: { data: [{ embedding: number[] }] }
 */
import type { ProbeCtx, ProbeResult } from "./index.js";

interface OpenAIEmbeddingResponse {
  data?: { embedding?: number[] }[];
  usage?: { prompt_tokens: number; total_tokens: number };
}

export async function runEmbeddingsOpenAIProbe({
  apiBaseUrl,
  apiKey,
  model,
  extraHeaders = {},
  pathOverride,
}: ProbeCtx): Promise<ProbeResult> {
  const path = pathOverride ?? "/v1/embeddings";
  const targetUrl = `${apiBaseUrl}${path}`;
  const body = { model, input: "Embed this short test sentence." };

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

  let data: OpenAIEmbeddingResponse;
  try {
    data = JSON.parse(rawText) as OpenAIEmbeddingResponse;
  } catch {
    return {
      pass: false,
      latencyMs,
      checks: [{ name: "HTTP 200 + JSON body", pass: false, info: `status=${res.status}` }],
      details: { error: `status=${res.status} body=${rawText.slice(0, 500)}` },
    };
  }

  const vec = data.data?.[0]?.embedding;
  const dims = Array.isArray(vec) ? vec.length : 0;
  const sample = Array.isArray(vec) ? vec.slice(0, 4) : undefined;

  const checks = [
    { name: "HTTP status 200", pass: res.status === 200, info: String(res.status) },
    { name: "data[0].embedding is array", pass: Array.isArray(vec) },
    { name: "Embedding has > 0 dims", pass: dims > 0, info: `${dims} dims` },
  ];
  const pass = checks.every((c) => c.pass);

  return {
    pass,
    latencyMs,
    checks,
    details: {
      embeddingDims: dims,
      ...(sample ? { embeddingSample: sample } : {}),
    },
  };
}
