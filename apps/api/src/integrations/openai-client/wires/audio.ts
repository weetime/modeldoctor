import { detectAudioFormat } from "../../utils/wav.js";

// Hard cap on raw audio bytes. Base64 inflates ~33%, so a 20MB blob arrives
// at the browser as ~27MB JSON — beyond that we'd risk OOM on the client and
// blow up the audio player anyway.
const MAX_TTS_AUDIO_BYTES = 20 * 1024 * 1024;

export interface BuildPlaygroundTtsBodyInput {
  model: string;
  input: string;
  voice: string;
  format: string;
  speed?: number;
  reference_audio_base64?: string;
  reference_text?: string;
}

export function buildPlaygroundTtsBody({
  model,
  input,
  voice,
  format,
  speed,
  reference_audio_base64,
  reference_text,
}: BuildPlaygroundTtsBodyInput): Record<string, unknown> {
  const body: Record<string, unknown> = { model, input, voice, response_format: format };
  if (speed !== undefined) body.speed = speed;
  if (reference_audio_base64 !== undefined) body.reference_audio_base64 = reference_audio_base64;
  if (reference_text !== undefined) body.reference_text = reference_text;
  return body;
}

export interface ParsedPlaygroundTtsResponse {
  audioBase64: string;
  format: string;
  bytes: number;
}

export async function parsePlaygroundTtsResponse(
  res: Response,
): Promise<ParsedPlaygroundTtsResponse> {
  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  if (buf.length > MAX_TTS_AUDIO_BYTES) {
    throw new Error(`audio too large (${(buf.length / 1024 / 1024).toFixed(1)} MB > 20 MB cap)`);
  }
  const format = detectAudioFormat(buf);
  return {
    audioBase64: buf.toString("base64"),
    format: format === "unknown" ? "mp3" : format,
    bytes: buf.length,
  };
}

export interface BuildPlaygroundTranscriptionsFormDataInput {
  file: { buffer: Buffer; originalname: string; mimetype: string };
  model: string;
  language?: string;
  task?: "transcribe" | "translate";
  prompt?: string;
  temperature?: number;
}

export function buildPlaygroundTranscriptionsFormData({
  file,
  model,
  language,
  task,
  prompt,
  temperature,
}: BuildPlaygroundTranscriptionsFormDataInput): FormData {
  const form = new FormData();
  const arrayBuffer = file.buffer.buffer.slice(
    file.buffer.byteOffset,
    file.buffer.byteOffset + file.buffer.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: file.mimetype });
  form.append("file", blob, file.originalname);
  form.append("model", model);
  if (language?.trim()) form.append("language", language);
  if (task) form.append("task", task);
  if (prompt?.trim()) form.append("prompt", prompt);
  if (temperature !== undefined) form.append("temperature", String(temperature));
  return form;
}

export function parsePlaygroundTranscriptionsResponse(json: unknown): { text: string } {
  const j = (json ?? {}) as { text?: string };
  return { text: typeof j.text === "string" ? j.text : "" };
}
