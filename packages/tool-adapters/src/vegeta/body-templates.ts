import type { VegetaParams } from "./schema.js";

// 1×1 transparent PNG — 67 bytes, smallest universally-decodable PNG. Lets
// real vision endpoints pass image-decode validation without depending on
// outbound network access from the runner pod.
const SAMPLE_IMAGE_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

// 44-byte silent mono 8 kHz 8-bit WAV (RIFF header + zero-length data chunk).
// Real audio endpoints accept this for shape-validation; they may 4xx later
// on empty samples, which is per-issue acceptance ("not 'missing input_audio'").
const SAMPLE_AUDIO_WAV_BASE64 = "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

/**
 * Canonical seed bodies for each `apiType`. Shapes mirror the OpenAI-compatible
 * payloads built by `apps/web/src/features/playground/chat/attachments.ts` and
 * validated by `ChatMessageContentPartSchema` in `@modeldoctor/contracts`.
 *
 * Used as:
 *   - vegeta default body (this package's `API_TYPE_TO_BODY`)
 *   - reference for any future tool that needs a "what does a real request look like" seed
 */
export const MODALITY_BODY_TEMPLATES: Record<VegetaParams["apiType"], (model: string) => string> = {
  chat: (m) => JSON.stringify({ model: m, messages: [{ role: "user", content: "hello" }] }),
  "chat-vision": (m) =>
    JSON.stringify({
      model: m,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is in this image?" },
            { type: "image_url", image_url: { url: SAMPLE_IMAGE_PNG_DATA_URL } },
          ],
        },
      ],
    }),
  "chat-audio": (m) =>
    JSON.stringify({
      model: m,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe this audio." },
            { type: "input_audio", input_audio: { data: SAMPLE_AUDIO_WAV_BASE64, format: "wav" } },
          ],
        },
      ],
    }),
  embeddings: (m) => JSON.stringify({ model: m, input: "hello" }),
  rerank: (m) => JSON.stringify({ model: m, query: "what is 2+2", documents: ["four", "five"] }),
  images: (m) => JSON.stringify({ model: m, prompt: "a cat" }),
};
