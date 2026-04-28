/**
 * TTS probe — pure text-to-speech (OpenAI /v1/audio/speech).
 *
 * Distinct from the chat-audio-omni probe: this targets dedicated TTS
 * services (OpenAI's TTS, gen-studio's Qwen-TTS, ElevenLabs-OpenAI-shim,
 * etc.) that return raw audio bytes — not JSON with base64 audio.
 */
import { detectAudioFormat } from "../utils/wav.js";
import type { ProbeCtx, ProbeResult } from "./index.js";

const TEST_INPUT = "Hello. This is a short test.";
const DEFAULT_VOICE = "alloy"; // OpenAI default voice; most compat shims accept this.

export async function runTTSProbe({
  apiBaseUrl,
  apiKey,
  model,
  extraHeaders = {},
  pathOverride,
}: ProbeCtx): Promise<ProbeResult> {
  const path = pathOverride ?? "/v1/audio/speech";
  const targetUrl = `${apiBaseUrl}${path}`;
  const body = { model, input: TEST_INPUT, voice: DEFAULT_VOICE };

  const t0 = Date.now();
  const res = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - t0;

  const contentType = (res.headers.get("Content-Type") ?? "").toLowerCase();
  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  const bytes = buf.length;
  const format = detectAudioFormat(buf);

  const checks = [
    { name: "HTTP status 200", pass: res.status === 200, info: String(res.status) },
    {
      name: "Content-Type is audio/*",
      pass: contentType.startsWith("audio/"),
      info: contentType || "(none)",
    },
    {
      name: "Audio payload > 1 KB",
      pass: bytes > 1024,
      info: `${bytes} bytes`,
    },
    {
      name: "Recognized audio format (wav/mp3/ogg/flac)",
      pass: format !== "unknown",
      info: format,
    },
  ];
  const pass = checks.every((c) => c.pass);

  // Only surface base64 audio for WAV (the FE <audio> element can play it
  // directly with data:audio/wav). For MP3/OGG/FLAC we still pass the
  // probe but skip the preview to avoid confusion when the FE expects WAV.
  const audioB64 = format === "wav" ? buf.toString("base64") : undefined;

  return {
    pass,
    latencyMs,
    checks,
    details: {
      audioBytes: bytes,
      ...(audioB64 ? { audioB64 } : {}),
    },
  };
}
