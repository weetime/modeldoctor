import type { PlaygroundChatRequest, PlaygroundChatResponse } from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import {
  buildHeaders,
  buildPlaygroundChatBody,
  buildUrl,
  parsePlaygroundChatResponse,
} from "../../integrations/openai-client/index.js";
import type { DecryptedConnection } from "../connection/connection.service.js";

const DEFAULT_PATH = "/v1/chat/completions";
const MAX_ERROR_BODY_BYTES = 1024;

@Injectable()
export class ChatService {
  async run(
    conn: DecryptedConnection,
    req: PlaygroundChatRequest,
  ): Promise<PlaygroundChatResponse> {
    const url = buildUrl({
      apiBaseUrl: conn.baseUrl,
      defaultPath: DEFAULT_PATH,
      pathOverride: req.pathOverride,
      queryParams: conn.queryParams,
    });
    const headers = buildHeaders(conn.apiKey, conn.customHeaders);
    // Phase 1 contract: stream is ignored for this non-streaming path.
    const params = { ...req.params, stream: undefined };
    const body = buildPlaygroundChatBody({
      model: conn.model,
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
    conn: DecryptedConnection,
    req: PlaygroundChatRequest,
  ): Promise<
    { kind: "ok"; upstream: Response } | { kind: "error"; status: number; error: string }
  > {
    const url = buildUrl({
      apiBaseUrl: conn.baseUrl,
      defaultPath: DEFAULT_PATH,
      pathOverride: req.pathOverride,
      queryParams: conn.queryParams,
    });
    const headers = buildHeaders(conn.apiKey, conn.customHeaders);
    const body = buildPlaygroundChatBody({
      model: conn.model,
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
