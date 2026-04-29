import type { PlaygroundChatRequest, PlaygroundChatResponse } from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import {
  buildHeaders,
  buildPlaygroundChatBody,
  buildUrl,
  parsePlaygroundChatResponse,
} from "../../integrations/openai-client/index.js";

const DEFAULT_PATH = "/v1/chat/completions";
const MAX_ERROR_BODY_BYTES = 1024;

@Injectable()
export class ChatService {
  async run(req: PlaygroundChatRequest): Promise<PlaygroundChatResponse> {
    const url = buildUrl({
      apiBaseUrl: req.apiBaseUrl,
      defaultPath: DEFAULT_PATH,
      pathOverride: req.pathOverride,
      queryParams: req.queryParams,
    });
    const headers = buildHeaders(req.apiKey, req.customHeaders);
    // Phase 1 contract: stream is ignored for this non-streaming path.
    const params = { ...req.params, stream: undefined };
    const body = buildPlaygroundChatBody({
      model: req.model,
      messages: req.messages,
      params,
    });
    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
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
      const json = await res.json();
      const parsed = parsePlaygroundChatResponse(json);
      return {
        success: true,
        content: parsed.content,
        latencyMs,
        usage: parsed.usage,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - start,
      };
    }
  }

  async runStream(
    req: PlaygroundChatRequest,
  ): Promise<
    { kind: "ok"; upstream: Response } | { kind: "error"; status: number; error: string }
  > {
    const url = buildUrl({
      apiBaseUrl: req.apiBaseUrl,
      defaultPath: DEFAULT_PATH,
      pathOverride: req.pathOverride,
      queryParams: req.queryParams,
    });
    const headers = buildHeaders(req.apiKey, req.customHeaders);
    const body = buildPlaygroundChatBody({
      model: req.model,
      messages: req.messages,
      params: { ...req.params, stream: true },
    });
    const upstream = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return {
        kind: "error",
        status: upstream.status,
        error: `upstream ${upstream.status}: ${text || upstream.statusText}`.slice(
          0,
          MAX_ERROR_BODY_BYTES,
        ),
      };
    }
    return { kind: "ok", upstream };
  }
}
