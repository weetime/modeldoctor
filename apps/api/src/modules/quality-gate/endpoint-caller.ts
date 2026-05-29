import {
  DEFAULT_GEN_CONFIG,
  type EndpointCallResult,
  type GenConfig,
} from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import { ConnectionService } from "../connection/connection.service.js";

const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 500;

/**
 * Build the /v1/chat/completions request body from a resolved GenConfig.
 * `thinking` maps to vLLM's `chat_template_kwargs.enable_thinking` — only sent
 * for "on"/"off"; "auto" omits it so non-vLLM endpoints don't 400 on the field.
 * Exported for unit testing the three-state mapping.
 */
export function buildRequestBody(model: string, prompt: string, gen: GenConfig): object {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: gen.temperature,
    max_tokens: gen.maxTokens,
  };
  if (gen.stop?.length) body.stop = gen.stop;
  if (gen.thinking === "off") body.chat_template_kwargs = { enable_thinking: false };
  else if (gen.thinking === "on") body.chat_template_kwargs = { enable_thinking: true };
  return body;
}

@Injectable()
export class EndpointCaller {
  constructor(private readonly connections: ConnectionService) {}

  async call(
    connectionId: string,
    userId: string,
    prompt: string,
    outerSignal: AbortSignal,
    gen: GenConfig = DEFAULT_GEN_CONFIG,
  ): Promise<EndpointCallResult> {
    const conn = await this.connections.getOwnedDecrypted(userId, connectionId).catch(() => null);
    if (!conn) {
      return { rawAnswer: "", latencyMs: 0, error: `connection ${connectionId} not found` };
    }
    const url = `${conn.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (conn.apiKey) headers.Authorization = `Bearer ${conn.apiKey}`;
    const body = JSON.stringify(buildRequestBody(conn.model, prompt, gen));
    return this.attempt(url, headers, body, outerSignal);
  }

  private async attempt(
    url: string,
    headers: Record<string, string>,
    body: string,
    outerSignal: AbortSignal,
  ): Promise<EndpointCallResult> {
    let lastErr: Error | undefined;
    for (let i = 0; i < 2; i++) {
      if (outerSignal.aborted) {
        return { rawAnswer: "", latencyMs: 0, error: "cancelled" };
      }
      const start = Date.now();
      const ctrl = new AbortController();
      const onOuterAbort = () => ctrl.abort();
      outerSignal.addEventListener("abort", onOuterAbort, { once: true });
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      try {
        const resp = await fetch(url, { method: "POST", headers, body, signal: ctrl.signal });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 256)}`);
        // Some vLLM builds with --reasoning-parser split thinking into
        // `reasoning_content` and leave `content` clean; we read `content`
        // (and stripThink() handles deployments that inline <think> instead).
        const data = (await resp.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        return {
          rawAnswer: data.choices?.[0]?.message?.content ?? "",
          latencyMs: Date.now() - start,
          tokensIn: data.usage?.prompt_tokens,
          tokensOut: data.usage?.completion_tokens,
        };
      } catch (e) {
        lastErr = e as Error;
        if (outerSignal.aborted) break;
        if (i === 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      } finally {
        clearTimeout(timer);
        outerSignal.removeEventListener("abort", onOuterAbort);
      }
    }
    return { rawAnswer: "", latencyMs: 0, error: lastErr?.message ?? "unknown error" };
  }
}
