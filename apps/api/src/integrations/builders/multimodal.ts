/**
 * Multimodal chat request builders.
 *
 * Both send to /v1/chat/completions but with different payload shapes:
 *   - vision: image+text in, text out
 *   - audio : text in, text+audio out (modalities=["audio"])
 *
 * Ported verbatim from the legacy CJS builder (src/builders/multimodal.js).
 */

export interface ChatVisionBodyConfig {
  model: string;
  prompt?: string;
  imageUrl?: string;
  maxTokens?: number | string;
  temperature?: number | string;
  systemPrompt?: string;
}

export interface ChatAudioBodyConfig {
  model: string;
  prompt?: string;
  systemPrompt?: string;
}

type ChatMessage = {
  role: "system" | "user";
  content: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
  >;
};

/**
 * Chat with image+text input (vision). Returns text.
 */
export function buildChatVisionBody({
  model,
  prompt,
  imageUrl,
  maxTokens,
  temperature,
  systemPrompt,
}: ChatVisionBodyConfig): Record<string, unknown> {
  if (!prompt) throw new Error("Missing required parameter: prompt");
  if (!imageUrl) throw new Error("Missing required parameter: imageUrl");

  const messages: ChatMessage[] = [];
  if (systemPrompt) {
    messages.push({
      role: "system",
      content: [{ type: "text", text: systemPrompt }],
    });
  }
  messages.push({
    role: "user",
    content: [
      { type: "image_url", image_url: { url: imageUrl } },
      { type: "text", text: prompt },
    ],
  });
  return {
    model,
    messages,
    max_tokens: Number.parseInt(maxTokens as string) || 256,
    temperature: Number.parseFloat(temperature as string) || 0.0,
  };
}

/**
 * Chat with text input, returns audio (TTS via omni/multimodal LLM).
 * Uses modalities=["audio"] which for vllm-omni means text + audio.
 */
export function buildChatAudioBody({
  model,
  prompt,
  systemPrompt,
}: ChatAudioBodyConfig): Record<string, unknown> {
  if (!prompt) throw new Error("Missing required parameter: prompt");

  const messages: ChatMessage[] = [];
  if (systemPrompt) {
    messages.push({
      role: "system",
      content: [{ type: "text", text: systemPrompt }],
    });
  }
  messages.push({
    role: "user",
    content: [{ type: "text", text: prompt }],
  });

  return {
    model,
    messages,
    modalities: ["audio"],
  };
}
