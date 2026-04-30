import type { PlaygroundImagesRequest, PlaygroundImagesResponse } from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import {
  buildHeaders,
  buildPlaygroundImagesBody,
  buildPlaygroundImagesEditFormData,
  buildUrl,
  parseImagesResponse,
} from "../../integrations/openai-client/index.js";

const DEFAULT_PATH = "/v1/images/generations";
const EDIT_DEFAULT_PATH = "/v1/images/edits";
const MAX_ERROR_BODY_BYTES = 1024;

export interface RunImagesEditInput {
  apiBaseUrl: string;
  apiKey: string;
  customHeaders?: string;
  queryParams?: string;
  pathOverride?: string;
  image: { buffer: Buffer; originalname: string; mimetype: string; size: number };
  mask: { buffer: Buffer; originalname: string; mimetype: string; size: number };
  model: string;
  prompt: string;
  n?: number;
  size?: string;
}

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

  async runEdit(input: RunImagesEditInput): Promise<PlaygroundImagesResponse> {
    const url = buildUrl({
      apiBaseUrl: input.apiBaseUrl,
      defaultPath: EDIT_DEFAULT_PATH,
      pathOverride: input.pathOverride,
      queryParams: input.queryParams,
    });
    // Multipart upload — strip Content-Type so fetch derives the boundary.
    const baseHeaders = buildHeaders(input.apiKey, input.customHeaders);
    const { "Content-Type": _ct, ...headers } = baseHeaders;
    const form = buildPlaygroundImagesEditFormData({
      image: input.image,
      mask: input.mask,
      model: input.model,
      prompt: input.prompt,
      n: input.n,
      size: input.size,
    });
    const start = Date.now();
    try {
      const res = await fetch(url, { method: "POST", headers, body: form });
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
