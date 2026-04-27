import { runAudioProbe } from "./audio.js";
import { runImageProbe } from "./image.js";
/**
 * Probe dispatcher + shared types.
 *
 * Each probe takes a ProbeCtx, makes a real HTTP call to the upstream model,
 * and returns a ProbeResult whose `details` shape matches the FE contract at
 * apps/web/src/features/e2e-smoke/types.ts byte-for-byte.
 */
import { runTextProbe } from "./text.js";

export { runTextProbe } from "./text.js";
export { runImageProbe } from "./image.js";
export { runAudioProbe } from "./audio.js";

export type ProbeName = "text" | "image" | "audio";

export interface ProbeCtx {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  extraHeaders: Record<string, string>;
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
  };
}

export type Probe = (ctx: ProbeCtx) => Promise<ProbeResult>;

export const PROBES: Record<ProbeName, Probe> = {
  text: runTextProbe,
  image: runImageProbe,
  audio: runAudioProbe,
};
