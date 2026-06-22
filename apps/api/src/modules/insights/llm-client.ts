// apps/api/src/modules/insights/llm-client.ts
import { setTimeout as wait } from "node:timers/promises";

export interface LlmClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Wire protocol. Defaults to "openai" (OpenAI-compatible /chat/completions). */
  apiStyle?: "openai" | "anthropic";
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
// Anthropic requires max_tokens; the 180s caller timeout comfortably covers a
// non-streaming response of this size on Opus-tier models.
const ANTHROPIC_DEFAULT_MAX_TOKENS = 16_000;
const ANTHROPIC_VERSION = "2023-06-01";

interface ChatOptions {
  timeoutMs?: number;
  jsonMode?: boolean;
  signal?: AbortSignal;
  /** Anthropic-only: caps the response. Ignored on the OpenAI path. */
  maxTokens?: number;
}

export async function chatCompletion(
  cfg: LlmClientConfig,
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<ChatResponse> {
  const ctl = new AbortController();
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = wait(timeout).then(() => ctl.abort());
  const onUserAbort = () => ctl.abort();
  options.signal?.addEventListener("abort", onUserAbort);

  const anthropic = cfg.apiStyle === "anthropic";
  const url = anthropic
    ? `${cfg.baseUrl.replace(/\/$/, "")}/v1/messages`
    : `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: ctl.signal,
      headers: anthropic
        ? {
            "content-type": "application/json",
            "x-api-key": cfg.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          }
        : {
            "content-type": "application/json",
            authorization: `Bearer ${cfg.apiKey}`,
          },
      body: anthropic
        ? JSON.stringify(buildAnthropicBody(cfg.model, messages, options.maxTokens))
        : JSON.stringify({
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

  if (anthropic) {
    const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
    // Concatenate text blocks; non-text blocks (thinking, tool_use) carry no text.
    // Guard the shape — a misconfigured gateway could return a non-array body.
    const blocks = Array.isArray(data.content) ? data.content : [];
    const content = blocks
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("");
    return { content, latencyMs };
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "";
  return { content, latencyMs };
}

/**
 * Build an Anthropic Messages API body. System messages are hoisted to the
 * top-level `system` field (Anthropic does not accept a "system" role inside
 * `messages`). No `temperature` — Opus 4.x rejects sampling params; JSON output
 * is steered by the prompt, not a response_format flag.
 */
function buildAnthropicBody(model: string, messages: ChatMessage[], maxTokens?: number) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const rest = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  return {
    model,
    max_tokens: maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
    ...(system ? { system } : {}),
    messages: rest,
  };
}
