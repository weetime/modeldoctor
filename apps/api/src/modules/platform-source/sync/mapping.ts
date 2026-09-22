import {
  ENGINE_IDS,
  type ModalityCategory,
  type ProbeName,
  type ServerKind,
} from "@modeldoctor/contracts";
import type { GpustackModel, GpustackRoute } from "../gpustack/types.js";

const CATEGORY_MAP: Record<string, ModalityCategory> = {
  llm: "chat",
  embedding: "embeddings",
  reranker: "rerank",
  image: "image",
  speech_to_text: "audio",
  text_to_speech: "audio",
};

export function toModalityCategory(categories: string[]): ModalityCategory {
  for (const c of categories) {
    const hit = CATEGORY_MAP[c];
    if (hit) return hit;
  }
  return "chat";
}

export function toServerKind(backend: string | null | undefined): ServerKind {
  const k = (backend ?? "").toLowerCase();
  return (ENGINE_IDS as readonly string[]).includes(k) ? (k as ServerKind) : "generic";
}

const PROBE_MAP: Record<string, ProbeName> = {
  llm: "chat-text",
  embedding: "embeddings-openai",
  reranker: "rerank-cohere",
  image: "image-gen",
  text_to_speech: "tts",
  speech_to_text: "asr",
};

export function toProbes(categories: string[]): ProbeName[] {
  for (const c of categories) {
    const hit = PROBE_MAP[c];
    if (hit) return [hit];
  }
  return ["chat-text"];
}

/** 只指向该模型、且由该模型创建的单目标路由（spec §5.2 第 3 步）。 */
export function resolveDedicatedRoute(modelId: number, routes: GpustackRoute[]): string | null {
  const r = routes.find((x) => x.created_model_id === modelId && x.targets === 1);
  if (!r) return null;
  return r.effective_name || r.name;
}

export function tokenizerFromSource(m: GpustackModel): string | null {
  if (m.source === "huggingface") return m.huggingface_repo_id ?? null;
  if (m.source === "model_scope") return m.model_scope_model_id ?? null;
  return null;
}
