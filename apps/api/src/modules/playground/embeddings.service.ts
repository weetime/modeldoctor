import type {
  PlaygroundEmbeddingsRequest,
  PlaygroundEmbeddingsResponse,
} from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import {
  buildHeaders,
  buildPlaygroundEmbeddingsBody,
  buildUrl,
  parseEmbeddingsResponse,
} from "../../integrations/openai-client/index.js";
import type { DecryptedConnection } from "../connection/connection.service.js";

const DEFAULT_PATH = "/v1/embeddings";
const MAX_ERROR_BODY_BYTES = 1024;

@Injectable()
export class EmbeddingsService {
  async run(
    conn: DecryptedConnection,
    req: PlaygroundEmbeddingsRequest,
  ): Promise<PlaygroundEmbeddingsResponse> {
    const url = buildUrl({
      apiBaseUrl: conn.baseUrl,
      defaultPath: DEFAULT_PATH,
      pathOverride: req.pathOverride,
      queryParams: conn.queryParams,
    });
    const headers = buildHeaders(conn.apiKey, conn.customHeaders);
    const body = buildPlaygroundEmbeddingsBody({
      model: conn.model,
      input: req.input,
      encodingFormat: req.encodingFormat,
      dimensions: req.dimensions,
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
      const parsed = parseEmbeddingsResponse(json);
      return {
        success: true,
        embeddings: parsed.embeddings,
        usage: parsed.usage,
        latencyMs,
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
