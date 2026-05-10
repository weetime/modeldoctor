import { safeFetch } from "../safe-fetch.js";
import type { HealthProbeData, ProbeCtx, ProbeResult } from "./index.js";

export async function runHealthProbe(ctx: ProbeCtx): Promise<ProbeResult<HealthProbeData>> {
  const start = Date.now();
  const base = ctx.baseUrl.replace(/\/+$/, "");
  for (const path of ["/health", "/healthz"] as const) {
    try {
      const res = await safeFetch(`${base}${path}`, { extraHeaders: ctx.extraHeaders });
      if (res.ok) {
        return { ok: true, durationMs: Date.now() - start, data: { path } };
      }
    } catch {
      // try next path
    }
  }
  return {
    ok: false,
    durationMs: Date.now() - start,
    reason: "no health endpoint (tried /health and /healthz)",
  };
}
