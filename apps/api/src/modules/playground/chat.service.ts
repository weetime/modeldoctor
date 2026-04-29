import type { PlaygroundChatRequest, PlaygroundChatResponse } from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";

const DEFAULT_PATH = "/v1/chat/completions";
const MAX_ERROR_BODY_BYTES = 1024;

function parseHeaderLines(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s || !s.trim()) return out;
  for (const rawLine of s.split("\n").map((l) => l.trim())) {
    if (!rawLine || !rawLine.includes(":")) continue;
    const idx = rawLine.indexOf(":");
    out[rawLine.slice(0, idx).trim()] = rawLine.slice(idx + 1).trim();
  }
  return out;
}

function parseQueryLines(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s || !s.trim()) return out;
  for (const rawLine of s.split("\n").map((l) => l.trim())) {
    if (!rawLine || !rawLine.includes("=")) continue;
    const idx = rawLine.indexOf("=");
    out[rawLine.slice(0, idx).trim()] = rawLine.slice(idx + 1).trim();
  }
  return out;
}

function buildBody(req: PlaygroundChatRequest): Record<string, unknown> {
  const p = req.params ?? {};
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
  };
  if (p.temperature !== undefined) body.temperature = p.temperature;
  if (p.maxTokens !== undefined) body.max_tokens = p.maxTokens;
  if (p.topP !== undefined) body.top_p = p.topP;
  if (p.frequencyPenalty !== undefined) body.frequency_penalty = p.frequencyPenalty;
  if (p.presencePenalty !== undefined) body.presence_penalty = p.presencePenalty;
  if (p.seed !== undefined) body.seed = p.seed;
  if (p.stop !== undefined) body.stop = p.stop;
  // Phase 1: stream is ignored (always non-streaming).
  return body;
}

@Injectable()
export class ChatService {
  async run(req: PlaygroundChatRequest): Promise<PlaygroundChatResponse> {
    const base = req.apiBaseUrl.replace(/\/+$/, "");
    const path = (req.pathOverride ?? DEFAULT_PATH).replace(/^(?!\/)/, "/");
    let url = base + path;
    const qp = parseQueryLines(req.queryParams);
    const qpKeys = Object.keys(qp);
    if (qpKeys.length > 0) {
      const search = new URLSearchParams();
      for (const k of qpKeys) search.set(k, qp[k]);
      url += (url.includes("?") ? "&" : "?") + search.toString();
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${req.apiKey}`,
      ...parseHeaderLines(req.customHeaders),
    };
    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(buildBody(req)),
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          success: false,
          error: `upstream ${res.status}: ${text || res.statusText}`.slice(0, MAX_ERROR_BODY_BYTES),
          latencyMs,
        };
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const content = json.choices?.[0]?.message?.content ?? "";
      return {
        success: true,
        content,
        latencyMs,
        usage: json.usage,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - start,
      };
    }
  }
}
