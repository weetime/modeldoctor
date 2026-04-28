/**
 * Image generation probe — OpenAI /v1/images/generations.
 *
 * Body: { model, prompt, size?, n?, response_format? }
 * Response: { data: [{ url? } | { b64_json? }] }
 *
 * Either url or b64_json is sufficient (depends on response_format).
 */
import type { ProbeCtx, ProbeResult } from "./index.js";

interface ImageGenResponse {
  data?: { url?: string; b64_json?: string }[];
}

export async function runImageGenProbe({
  apiBaseUrl,
  apiKey,
  model,
  extraHeaders = {},
  pathOverride,
}: ProbeCtx): Promise<ProbeResult> {
  const path = pathOverride ?? "/v1/images/generations";
  const targetUrl = `${apiBaseUrl}${path}`;
  const body = {
    model,
    prompt: "A small red apple on a white background.",
    n: 1,
    size: "512x512",
  };

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

  let data: ImageGenResponse;
  try {
    data = JSON.parse(rawText) as ImageGenResponse;
  } catch {
    return {
      pass: false,
      latencyMs,
      checks: [{ name: "HTTP 200 + JSON body", pass: false, info: `status=${res.status}` }],
      details: { error: `status=${res.status} body=${rawText.slice(0, 500)}` },
    };
  }

  const first = data.data?.[0];
  const url = first?.url;
  const b64 = first?.b64_json;
  const hasArtifact = typeof url === "string" || typeof b64 === "string";

  const checks = [
    { name: "HTTP status 200", pass: res.status === 200, info: String(res.status) },
    { name: "Response has data[0].url or data[0].b64_json", pass: hasArtifact },
  ];
  const pass = checks.every((c) => c.pass);

  return {
    pass,
    latencyMs,
    checks,
    details: {
      ...(url ? { imageGenUrl: url } : {}),
      ...(b64 ? { imageGenB64: b64 } : {}),
    },
  };
}
