/**
 * Image+text probe.
 *
 * Ported verbatim from the legacy CJS probe (src/probes/image.js).
 * Sends a cat photo and asserts the reply recognizes it as a cat.
 *
 * Asset path: the legacy layout kept `cat.jpg` at `src/probes/assets/cat.jpg`
 * (sibling to the probe file). The new layout moves it to
 * `apps/api/src/integrations/assets/cat.jpg` (one level up from probes/).
 * We rely on `__dirname` which is available under `module: commonjs` and
 * resolves to the emitted .js location — `dist/integrations/probes/` at
 * runtime, `src/integrations/probes/` under ts-node/vitest — both of which
 * are one dir down from `assets/`. Switch to `import.meta.url` only if
 * tsconfig moves to ESM later.
 */
import fs from "node:fs";
import path from "node:path";
import { buildChatVisionBody } from "../builders/multimodal.js";
import type { ProbeCtx, ProbeResult } from "./index.js";

const CAT_JPG_B64 = fs
  .readFileSync(path.join(__dirname, "..", "assets", "cat.jpg"))
  .toString("base64");

interface ChatCompletionLike {
  choices?: Array<{ message?: { content?: string } }>;
}

export async function runImageProbe({
  apiBaseUrl,
  apiKey,
  model,
  extraHeaders = {},
}: ProbeCtx): Promise<ProbeResult> {
  const body = buildChatVisionBody({
    model,
    imageUrl: `data:image/jpeg;base64,${CAT_JPG_B64}`,
    prompt: "What animal is in this image? Answer with one word.",
    maxTokens: 16,
    temperature: 0,
  });
  const targetUrl = `${apiBaseUrl}/v1/chat/completions`;
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
  const checks = [
    {
      name: "HTTP status 200",
      pass: res.status === 200,
      info: String(res.status),
    },
    { name: "Non-empty reply", pass: content.trim().length > 0 },
    {
      name: "Reply mentions 'cat'",
      pass: /cat|kitten|feline|猫/i.test(content),
    },
  ];
  const pass = checks.every((c) => c.pass);

  return {
    pass,
    latencyMs,
    checks,
    details: {
      content,
      imagePreviewB64: CAT_JPG_B64,
      imageMime: "image/jpeg",
    },
  };
}
