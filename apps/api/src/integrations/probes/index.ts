import type { ProbeName } from "@modeldoctor/contracts";
import { runASRProbe } from "./asr.js";
import { runChatAudioOmniProbe } from "./chat-audio-omni.js";
import { runChatTextProbe } from "./chat-text.js";
import { runChatVisionProbe } from "./chat-vision.js";
import { runEmbeddingsOpenAIProbe } from "./embeddings-openai.js";
import { runEmbeddingsTEIProbe } from "./embeddings-tei.js";
import { runImageGenProbe } from "./image-gen.js";
import { runRerankCohereProbe } from "./rerank-cohere.js";
import { runRerankTEIProbe } from "./rerank-tei.js";
import { runTTSProbe } from "./tts.js";

export { runChatTextProbe } from "./chat-text.js";
export { runChatVisionProbe } from "./chat-vision.js";
export { runChatAudioOmniProbe } from "./chat-audio-omni.js";
export { runEmbeddingsOpenAIProbe } from "./embeddings-openai.js";
export { runEmbeddingsTEIProbe } from "./embeddings-tei.js";
export { runRerankTEIProbe } from "./rerank-tei.js";
export { runRerankCohereProbe } from "./rerank-cohere.js";
export { runTTSProbe } from "./tts.js";
export { runASRProbe } from "./asr.js";
export { runImageGenProbe } from "./image-gen.js";

export interface ProbeCtx {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  extraHeaders: Record<string, string>;
  /**
   * Optional path override (from the request's pathOverride[probeName]).
   * If undefined, the probe falls back to its hardcoded OpenAI / TEI /
   * Cohere default. Always starts with "/" — the probe prepends apiBaseUrl.
   */
  pathOverride?: string;
}

export interface ProbeCheck {
  name: string;
  pass: boolean;
  info?: string;
}

export interface ProbeResult {
  pass: boolean;
  latencyMs: number | null;
  checks: ProbeCheck[];
  details: {
    content?: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
    imagePreviewB64?: string;
    imageMime?: string;
    audioB64?: string;
    audioBytes?: number;
    numChoices?: number;
    textReply?: string;
    error?: string;
    embeddingDims?: number;
    embeddingSample?: number[];
    rerankResults?: { index: number; score: number }[];
    imageGenUrl?: string;
    imageGenB64?: string;
  };
}

export type Probe = (ctx: ProbeCtx) => Promise<ProbeResult>;

// Subsequent tasks (3..7) add the remaining 7 probes — embeddings-openai/tei,
// rerank-tei/cohere, tts, asr, image-gen. The Partial<> here is temporary
// for the duration of those tasks; Task 8 narrows it back to a complete
// Record once every probe is wired.
export const PROBES: Partial<Record<ProbeName, Probe>> = {
  "chat-text": runChatTextProbe,
  "chat-vision": runChatVisionProbe,
  "chat-audio-omni": runChatAudioOmniProbe,
  "embeddings-openai": runEmbeddingsOpenAIProbe,
  "embeddings-tei": runEmbeddingsTEIProbe,
  "rerank-tei": runRerankTEIProbe,
  "rerank-cohere": runRerankCohereProbe,
  tts: runTTSProbe,
  asr: runASRProbe,
  "image-gen": runImageGenProbe,
};
