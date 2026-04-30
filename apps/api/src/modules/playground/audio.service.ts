import type {
  PlaygroundTranscriptionsBody,
  PlaygroundTranscriptionsResponse,
  PlaygroundTtsRequest,
  PlaygroundTtsResponse,
} from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import {
  buildHeaders,
  buildPlaygroundTranscriptionsFormData,
  buildPlaygroundTtsBody,
  buildUrl,
  parsePlaygroundTranscriptionsResponse,
  parsePlaygroundTtsResponse,
} from "../../integrations/openai-client/index.js";

const TTS_DEFAULT_PATH = "/v1/audio/speech";
const STT_DEFAULT_PATH = "/v1/audio/transcriptions";
const MAX_ERROR_BODY_BYTES = 1024;

export interface RunTranscriptionsInput {
  file: { buffer: Buffer; originalname: string; mimetype: string; size: number };
  body: PlaygroundTranscriptionsBody;
}

@Injectable()
export class AudioService {
  async runTts(req: PlaygroundTtsRequest): Promise<PlaygroundTtsResponse> {
    const url = buildUrl({
      apiBaseUrl: req.apiBaseUrl,
      defaultPath: TTS_DEFAULT_PATH,
      pathOverride: req.pathOverride,
      queryParams: req.queryParams,
    });
    const headers = buildHeaders(req.apiKey, req.customHeaders);
    const body = buildPlaygroundTtsBody({
      model: req.model, input: req.input, voice: req.voice, format: req.format, speed: req.speed,
    });
    const start = Date.now();
    try {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          success: false,
          error: `upstream ${res.status}: ${text || res.statusText}`.slice(0, MAX_ERROR_BODY_BYTES),
          latencyMs,
        };
      }
      const parsed = await parsePlaygroundTtsResponse(res);
      return { success: true, audioBase64: parsed.audioBase64, format: parsed.format, latencyMs };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - start,
      };
    }
  }

  async runTranscriptions(input: RunTranscriptionsInput): Promise<PlaygroundTranscriptionsResponse> {
    const { file, body } = input;
    const url = buildUrl({
      apiBaseUrl: body.apiBaseUrl,
      defaultPath: STT_DEFAULT_PATH,
      pathOverride: body.pathOverride,
      queryParams: body.queryParams,
    });
    // For multipart uploads we MUST NOT set Content-Type — fetch derives the boundary.
    const baseHeaders = buildHeaders(body.apiKey, body.customHeaders);
    const { "Content-Type": _ct, ...headers } = baseHeaders;
    const form = buildPlaygroundTranscriptionsFormData({
      file: { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      model: body.model,
      language: body.language,
      task: body.task,
      prompt: body.prompt,
      temperature: body.temperature,
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
      const parsed = parsePlaygroundTranscriptionsResponse(json);
      return { success: true, text: parsed.text, latencyMs };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - start,
      };
    }
  }
}
