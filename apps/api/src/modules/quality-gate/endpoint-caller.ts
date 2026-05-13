import type { EndpointCallResult } from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import { ConnectionService } from "../connection/connection.service.js";

const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 500;
const MAX_TOKENS = 2048;

@Injectable()
export class EndpointCaller {
  constructor(private readonly connections: ConnectionService) {}

  async call(
    connectionId: string,
    userId: string,
    prompt: string,
    outerSignal: AbortSignal,
  ): Promise<EndpointCallResult> {
    const conn = await this.connections.getOwnedDecrypted(userId, connectionId).catch(() => null);
    if (!conn) {
      return { rawAnswer: "", latencyMs: 0, error: `connection ${connectionId} not found` };
    }
    const url = `${conn.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (conn.apiKey) headers.Authorization = `Bearer ${conn.apiKey}`;
    const body = JSON.stringify({
      model: conn.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: MAX_TOKENS,
    });
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
