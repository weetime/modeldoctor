/**
 * ASR probe — speech-to-text via the OpenAI /v1/audio/transcriptions endpoint.
 *
 * Posts a tiny built-in 1-second silent WAV (committed at
 * fixtures/sample-1s-silence.wav) so the probe is hermetic — no network
 * fixture, no AudioContext synthesis at runtime. The expectation is just
 * that the server returns a JSON body with a `text` field; the value
 * itself may be empty for silence (which is fine — we're smoke-testing
 * pipeline reachability, not transcription accuracy).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProbeCtx, ProbeResult } from "./index.js";

// Under `module: commonjs`, __dirname is the Node CJS global. It resolves to
// `dist/integrations/probes/` at runtime and `src/integrations/probes/` under
// vitest — fixtures/ lives next to this file in both. Mirrors the pattern
// used in chat-vision.ts (which loads ../assets/cat.jpg the same way).
const FIXTURE_PATH = join(__dirname, "fixtures", "sample-1s-silence.wav");

interface TranscriptionResponse {
  text?: string;
}

export async function runASRProbe({
  apiBaseUrl,
  apiKey,
  model,
  extraHeaders = {},
  pathOverride,
}: ProbeCtx): Promise<ProbeResult> {
  const path = pathOverride ?? "/v1/audio/transcriptions";
  const targetUrl = `${apiBaseUrl}${path}`;

  const wavBytes = await readFile(FIXTURE_PATH);
  const form = new FormData();
  form.append(
    "file",
    new Blob(
      [wavBytes.buffer.slice(wavBytes.byteOffset, wavBytes.byteOffset + wavBytes.byteLength)],
      { type: "audio/wav" },
    ),
    "sample-1s-silence.wav",
  );
  form.append("model", model);

  const t0 = Date.now();
  const res = await fetch(targetUrl, {
    method: "POST",
    headers: {
      // Don't set Content-Type — let fetch derive the multipart boundary.
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: form,
  });
  const latencyMs = Date.now() - t0;
  const rawText = await res.text();

  let data: TranscriptionResponse;
  try {
    data = JSON.parse(rawText) as TranscriptionResponse;
  } catch {
    return {
      pass: false,
      latencyMs,
      checks: [{ name: "HTTP 200 + JSON body", pass: false, info: `status=${res.status}` }],
      details: { error: `status=${res.status} body=${rawText.slice(0, 500)}` },
    };
  }

  const checks = [
    { name: "HTTP status 200", pass: res.status === 200, info: String(res.status) },
    { name: "Response has `text` field", pass: typeof data.text === "string" },
  ];
  const pass = checks.every((c) => c.pass);

  return {
    pass,
    latencyMs,
    checks,
    details: {
      ...(data.text !== undefined ? { textReply: data.text } : {}),
    },
  };
}
