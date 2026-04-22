/**
 * Text-only probe.
 *
 * Ported verbatim from the legacy CJS probe (src/probes/text.js).
 * Sends a deterministic prompt and asserts the reply contains a marker.
 *
 * Uses Node 20 native `fetch` (global). Preserves:
 *   - check names and ordering
 *   - latencyMs measurement window (request send → response body read completes)
 *   - fallback path when the body is not JSON
 *
 * Shape deviation from legacy: the FE contract (apps/web/.../types.ts) limits
 * `details` to a fixed union. The legacy probe emitted `{ status, body }` on
 * parse failure and `{ content, usage, model }` on success. Here we keep only
 * the FE-allowed fields and fold parse-failure context into `details.error`.
 */
import { buildChatBody } from "../builders/chat.js";
import type { ProbeCtx, ProbeResult } from "./index.js";

interface ChatCompletionLike {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
}

export async function runTextProbe({
  apiUrl,
  apiKey,
  model,
  extraHeaders = {},
}: ProbeCtx): Promise<ProbeResult> {
  const body = buildChatBody({
    model,
    prompt: "Reply with exactly: OK-TEXT-123",
    maxTokens: 32,
    temperature: 0,
    stream: false,
  });
  const t0 = Date.now();
  const res = await fetch(apiUrl, {
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
  let data: ChatCompletionLike;
  try {
    data = JSON.parse(rawText) as ChatCompletionLike;
  } catch {
    return {
      pass: false,
      latencyMs,
      checks: [
        {
          name: "HTTP 200 + JSON body",
          pass: false,
          info: `status=${res.status}`,
        },
      ],
      details: {
        error: `status=${res.status} body=${rawText.slice(0, 500)}`,
      },
    };
  }

  const content = data?.choices?.[0]?.message?.content ?? "";
  const usage = data?.usage ?? {};
  const completionTokens = usage.completion_tokens ?? 0;
  const promptTokens = usage.prompt_tokens ?? 0;
  const checks = [
    {
      name: "HTTP status 200",
      pass: res.status === 200,
      info: String(res.status),
    },
    {
      name: "Reply contains marker OK-TEXT-123",
      pass: content.includes("OK-TEXT-123"),
    },
    {
      name: "completion_tokens > 0",
      pass: completionTokens > 0,
      info: `tokens=${completionTokens}`,
    },
  ];
  const pass = checks.every((c) => c.pass);

  return {
    pass,
    latencyMs,
    checks,
    details: {
      content,
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
      },
    },
  };
}
