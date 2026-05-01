import type { PlaygroundRerankRequest, PlaygroundRerankResponse } from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import {
  buildHeaders,
  buildPlaygroundRerankBody,
  buildUrl,
  parseRerankResponse,
} from "../../integrations/openai-client/index.js";
import type { DecryptedConnection } from "../connection/connection.service.js";

const DEFAULT_PATH_COHERE = "/v1/rerank";
const DEFAULT_PATH_TEI = "/rerank";
const MAX_ERROR_BODY_BYTES = 1024;

@Injectable()
export class RerankService {
  async run(
    conn: DecryptedConnection,
    req: PlaygroundRerankRequest,
  ): Promise<PlaygroundRerankResponse> {
    const defaultPath = req.wire === "tei" ? DEFAULT_PATH_TEI : DEFAULT_PATH_COHERE;
    const url = buildUrl({
      apiBaseUrl: conn.baseUrl,
      defaultPath,
      pathOverride: req.pathOverride,
      queryParams: conn.queryParams,
    });
    const headers = buildHeaders(conn.apiKey, conn.customHeaders);
    const body = buildPlaygroundRerankBody({
      model: conn.model,
      query: req.query,
      documents: req.documents,
      topN: req.topN,
      returnDocuments: req.returnDocuments,
      wire: req.wire,
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
      const results = parseRerankResponse(json);
      return { success: true, results, latencyMs };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - start,
      };
    }
  }
}
