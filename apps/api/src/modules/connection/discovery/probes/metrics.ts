import { safeFetch } from "../safe-fetch.js";
import type { MetricsProbeData, ProbeCtx, ProbeResult } from "./index.js";

const MAX_BODY_BYTES = 64 * 1024;

export async function runMetricsProbe(ctx: ProbeCtx): Promise<ProbeResult<MetricsProbeData>> {
  const start = Date.now();
  try {
    // /metrics is conventionally unauthenticated on a bare engine, but real-
    // world deployments behind a gateway (Higress, Istio, internal proxies)
    // often require the same auth as the inference path. Forward both apiKey
    // AND extraHeaders so gated metrics endpoints work — bare engines simply
    // ignore the unused Authorization header.
    const res = await safeFetch(`${ctx.baseUrl.replace(/\/+$/, "")}/metrics`, {
      apiKey: ctx.apiKey,
      extraHeaders: ctx.extraHeaders,
    });
    if (!res.ok) {
      return { ok: false, durationMs: Date.now() - start, reason: `HTTP ${res.status}` };
    }
    const full = await res.text();
    const body = full.length > MAX_BODY_BYTES ? full.slice(0, MAX_BODY_BYTES) : full;
    return { ok: true, durationMs: Date.now() - start, data: { body } };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - start,
      reason: err instanceof Error ? err.message : "unknown error",
    };
  }
}
