import { safeFetch } from "../safe-fetch.js";
import type { ModelsProbeData, ProbeCtx, ProbeResult } from "./index.js";

export async function runModelsProbe(ctx: ProbeCtx): Promise<ProbeResult<ModelsProbeData>> {
  const start = Date.now();
  try {
    const res = await safeFetch(`${ctx.baseUrl.replace(/\/+$/, "")}/v1/models`, {
      apiKey: ctx.apiKey,
    });
    if (!res.ok) {
      return { ok: false, durationMs: Date.now() - start, reason: `HTTP ${res.status}` };
    }
    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      return {
        ok: false,
        durationMs: Date.now() - start,
        reason: "Response not parseable as JSON",
      };
    }
    const models = extractModels(raw);
    return { ok: true, durationMs: Date.now() - start, data: { models, raw } };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - start,
      reason: err instanceof Error ? err.message : "unknown error",
    };
  }
}

function extractModels(raw: unknown): string[] {
  if (raw && typeof raw === "object" && "data" in raw && Array.isArray((raw as { data: unknown }).data)) {
    return ((raw as { data: Array<{ id?: unknown }> }).data)
      .map((m) => (typeof m?.id === "string" ? m.id : null))
      .filter((id): id is string => id !== null);
  }
  if (Array.isArray(raw)) {
    return raw
      .map((m) =>
        m && typeof m === "object" && typeof (m as { id?: unknown }).id === "string"
          ? (m as { id: string }).id
          : null,
      )
      .filter((id): id is string => id !== null);
  }
  return [];
}
