import type { ModalityCategory, InferenceConfidence } from "@modeldoctor/contracts";

interface Inputs {
  models: string[];
}

interface InferredField {
  value: ModalityCategory | null;
  confidence: InferenceConfidence;
  evidence: string;
}

/**
 * Match rules in priority order. First hit wins.
 *
 * rerank MUST come before embed because "bge-reranker" contains "embed"-adjacent
 * context — but more importantly, distinct keyword `rerank` is the strongest signal.
 */
const RULES: Array<{ pattern: RegExp; category: ModalityCategory; keyword: string }> = [
  { pattern: /\b(rerank|reranker)\b/, category: "rerank", keyword: "rerank" },
  { pattern: /(?:^|[\W_])(embed|bge|e5-|gte-|m3e)/, category: "embeddings", keyword: "embed/bge/e5/gte/m3e" },
  { pattern: /(flux|sd-|stable-diffusion|dall-?e|imagen)/, category: "image", keyword: "flux/sd/dall-e/imagen" },
  { pattern: /(whisper|voxtral|tts|parakeet)/, category: "audio", keyword: "whisper/voxtral/tts/parakeet" },
];

export function inferCategory(inputs: Inputs): InferredField {
  if (inputs.models.length === 0) {
    return { value: null, confidence: "unknown", evidence: "no models discovered" };
  }
  const id = inputs.models[0].toLowerCase();
  for (const rule of RULES) {
    if (rule.pattern.test(id)) {
      return {
        value: rule.category,
        confidence: "likely",
        evidence: `matched '${rule.keyword}' in model id '${inputs.models[0]}'`,
      };
    }
  }
  return {
    value: "chat",
    confidence: "guess",
    evidence: `default — no category keyword in '${inputs.models[0]}'`,
  };
}
