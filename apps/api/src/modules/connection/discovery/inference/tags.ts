import type { InferenceConfidence, ModalityCategory, ServerKind } from "@modeldoctor/contracts";

interface Inputs {
  serverKind: ServerKind | null;
  category: ModalityCategory | null;
  models: string[];
  /**
   * Free-form gateway markers derived from the server-header probe
   * (`higress`, etc.) — see `deriveGatewayHints` in discovery.service.ts.
   * Gateways aren't part of the engine taxonomy (`serverKind`), but
   * presence is worth surfacing as a tag so downstream code can key off
   * `tags.includes("higress")` (e.g. to fetch Higress AI-Statistics metrics
   * from the gateway's own Prometheus namespace). Optional — omitting is
   * equivalent to "no gateway detected".
   */
  gatewayHints?: string[];
}

interface InferredList {
  values: string[];
  confidence: InferenceConfidence;
  evidence: string;
}

const SIZE_RE = /\b(\d+(?:\.\d+)?)b\b/i;
const FORM_FACTOR_KEYWORDS = ["instruct", "chat", "base", "code", "math"];
const QUANT_KEYWORDS = ["awq", "gptq", "fp8", "int4"];

const MAX_TAGS = 8;

export function inferTags(inputs: Inputs): InferredList {
  const tags = new Set<string>();
  const evidence: string[] = [];

  if (inputs.serverKind) {
    tags.add(inputs.serverKind);
    evidence.push(`serverKind=${inputs.serverKind}`);
  }
  if (inputs.category) {
    tags.add(inputs.category);
    evidence.push(`category=${inputs.category}`);
  }
  for (const hint of inputs.gatewayHints ?? []) {
    tags.add(hint);
  }
  if ((inputs.gatewayHints ?? []).length > 0) {
    evidence.push(`gateway=${(inputs.gatewayHints ?? []).join(",")}`);
  }

  for (const id of inputs.models) {
    const lower = id.toLowerCase();

    const sizeMatch = lower.match(SIZE_RE);
    if (sizeMatch) tags.add(`${sizeMatch[1]}b`);

    for (const kw of FORM_FACTOR_KEYWORDS) {
      if (lower.includes(kw)) tags.add(kw);
    }
    for (const kw of QUANT_KEYWORDS) {
      if (lower.includes(kw)) tags.add(kw);
    }

    if (tags.size >= MAX_TAGS) break;
  }

  const values = Array.from(tags).slice(0, MAX_TAGS);

  if (values.length === 0) {
    return { values: [], confidence: "unknown", evidence: "no inputs" };
  }
  return {
    values,
    confidence: "guess",
    evidence: `derived from ${evidence.join(", ")}${inputs.models.length > 0 ? " + model ids" : ""}`,
  };
}
