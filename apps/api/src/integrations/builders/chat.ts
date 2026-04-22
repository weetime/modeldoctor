/**
 * Builds an OpenAI-compatible chat completion request body.
 *
 * Ported verbatim from the legacy CJS builder (src/builders/chat.js).
 * Behaviour is preserved exactly, including the numeric-coercion fallbacks:
 *   parseInt(maxTokens) || 1000
 *   parseFloat(temperature) || 0.7
 * Any truthy-zero or NaN collapses to the defaults above, matching the old JS.
 */

export interface ChatBodyConfig {
  model: string;
  prompt?: string;
  // Accepted loosely because the original JS ran parseInt/parseFloat on whatever
  // came in from the HTTP body (strings from form submissions, numbers from JSON).
  maxTokens?: number | string;
  temperature?: number | string;
  stream?: boolean;
}

export function buildChatBody({
  model,
  prompt,
  maxTokens,
  temperature,
  stream,
}: ChatBodyConfig): Record<string, unknown> {
  if (!prompt) throw new Error("Missing required parameter: prompt");
  return {
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: parseInt(maxTokens as string) || 1000,
    temperature: parseFloat(temperature as string) || 0.7,
    stream: !!stream,
  };
}
