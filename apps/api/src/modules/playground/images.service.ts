import type { PlaygroundImagesRequest, PlaygroundImagesResponse } from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import {
  buildHeaders,
  buildPlaygroundImagesBody,
  buildUrl,
  parseImagesResponse,
} from "../../integrations/openai-client/index.js";

const DEFAULT_PATH = "/v1/images/generations";
const MAX_ERROR_BODY_BYTES = 1024;

@Injectable()
export class ImagesService {
  async run(req: PlaygroundImagesRequest): Promise<PlaygroundImagesResponse> {
    const url = buildUrl({
      apiBaseUrl: req.apiBaseUrl,
      defaultPath: DEFAULT_PATH,
      pathOverride: req.pathOverride,
      queryParams: req.queryParams,
    });
    const headers = buildHeaders(req.apiKey, req.customHeaders);
    const body = buildPlaygroundImagesBody({
      model: req.model,
      prompt: req.prompt,
      size: req.size,
      n: req.n,
      responseFormat: req.responseFormat,
      seed: req.seed,
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
      const artifacts = parseImagesResponse(json);
      return { success: true, artifacts, latencyMs };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - start,
      };
    }
  }
}
