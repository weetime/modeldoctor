// apps/api/src/modules/insights/llm-client.ts
import { setTimeout as wait } from "node:timers/promises";

export interface LlmClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  content: string;
  latencyMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function chatCompletion(
  cfg: LlmClientConfig,
  messages: ChatMessage[],
  options: { timeoutMs?: number; jsonMode?: boolean; signal?: AbortSignal } = {},
): Promise<ChatResponse> {
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const ctl = new AbortController();
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = wait(timeout).then(() => ctl.abort());
  const onUserAbort = () => ctl.abort();
  options.signal?.addEventListener("abort", onUserAbort);

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: 0.2,
        ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });
  } finally {
    options.signal?.removeEventListener("abort", onUserAbort);
    timer.then(() => undefined).catch(() => undefined);
  }

  const latencyMs = Date.now() - t0;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "";
  return { content, latencyMs };
}
