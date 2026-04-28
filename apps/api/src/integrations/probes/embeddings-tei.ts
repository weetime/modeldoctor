/**
 * Embeddings probe — TEI native shape.
 *
 * POST {apiBaseUrl}{pathOverride ?? "/embed"}
 * Body: { inputs: ["..."] }
 * Response: number[][] (one embedding vector per input).
 */
import type { ProbeCtx, ProbeResult } from "./index.js";

export async function runEmbeddingsTEIProbe({
  apiBaseUrl,
  apiKey,
  model: _model,
  extraHeaders = {},
  pathOverride,
}: ProbeCtx): Promise<ProbeResult> {
  const path = pathOverride ?? "/embed";
  const targetUrl = `${apiBaseUrl}${path}`;
  const body = { inputs: ["Embed this short test sentence."] };

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

  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    return {
      pass: false,
      latencyMs,
      checks: [{ name: "HTTP 200 + JSON body", pass: false, info: `status=${res.status}` }],
      details: { error: `status=${res.status} body=${rawText.slice(0, 500)}` },
    };
  }

  const vec = Array.isArray(data) && Array.isArray(data[0]) ? (data[0] as number[]) : null;
  const dims = vec?.length ?? 0;

  const checks = [
    { name: "HTTP status 200", pass: res.status === 200, info: String(res.status) },
    { name: "Top-level is number[][]", pass: vec !== null },
    { name: "Embedding has > 0 dims", pass: dims > 0, info: `${dims} dims` },
  ];
  const pass = checks.every((c) => c.pass);

  return {
    pass,
    latencyMs,
    checks,
    details: {
      embeddingDims: dims,
      ...(vec ? { embeddingSample: vec.slice(0, 4) } : {}),
    },
  };
}
