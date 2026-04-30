import { detectAudioFormat } from "../../utils/wav.js";

const MAX_TTS_AUDIO_BYTES = 20 * 1024 * 1024;

export interface BuildTtsBodyInput {
  model: string;
  input: string;
  voice: string;
  format: string;
  speed?: number;
}

export function buildTtsBody({
  model, input, voice, format, speed,
}: BuildTtsBodyInput): Record<string, unknown> {
  const body: Record<string, unknown> = { model, input, voice, response_format: format };
  if (speed !== undefined) body.speed = speed;
  return body;
}

export interface ParsedTtsResponse {
  audioBase64: string;
  format: string;
  bytes: number;
}

export async function parseTtsResponse(res: Response): Promise<ParsedTtsResponse> {
  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  if (buf.length > MAX_TTS_AUDIO_BYTES) {
    throw new Error(
      `audio too large (${(buf.length / 1024 / 1024).toFixed(1)} MB > 20 MB cap)`,
    );
  }
  const format = detectAudioFormat(buf);
  return {
    audioBase64: buf.toString("base64"),
    format: format === "unknown" ? "mp3" : format,
    bytes: buf.length,
  };
}

export interface BuildTranscriptionsFormDataInput {
  file: { buffer: Buffer; originalname: string; mimetype: string };
  model: string;
  language?: string;
  task?: "transcribe" | "translate";
  prompt?: string;
  temperature?: number;
}

export function buildTranscriptionsFormData({
  file, model, language, task, prompt, temperature,
}: BuildTranscriptionsFormDataInput): FormData {
  const form = new FormData();
  const arrayBuffer = file.buffer.buffer.slice(
    file.buffer.byteOffset,
    file.buffer.byteOffset + file.buffer.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: file.mimetype });
  form.append("file", blob, file.originalname);
  form.append("model", model);
  if (language && language.trim()) form.append("language", language);
  if (task) form.append("task", task);
  if (prompt && prompt.trim()) form.append("prompt", prompt);
  if (temperature !== undefined) form.append("temperature", String(temperature));
  return form;
}

export function parseTranscriptionsResponse(json: unknown): { text: string } {
  const j = (json ?? {}) as { text?: string };
  return { text: typeof j.text === "string" ? j.text : "" };
}
