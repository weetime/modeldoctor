import { safeFetch } from "../safe-fetch.js";
import type { ProbeCtx, ProbeResult, ServerHeaderProbeData } from "./index.js";

export async function runServerHeaderProbe(
  ctx: ProbeCtx,
): Promise<ProbeResult<ServerHeaderProbeData>> {
  const start = Date.now();
  try {
    // noFollow: don't chase 3xx — we want the FRONT hop's `Server` header.
    // For gateway-fronted deployments (e.g. Higress at `/` 301-redirecting
    // to a fallback host), the 301 response itself carries `Server:
    // istio-envoy` while the redirect target is a totally unrelated origin
    // whose header is misleading.
    const res = await safeFetch(`${ctx.baseUrl.replace(/\/+$/, "")}/`, {
      apiKey: ctx.apiKey,
      extraHeaders: ctx.extraHeaders,
      noFollow: true,
    });
    return {
      ok: true,
      durationMs: Date.now() - start,
      data: {
        server: res.headers.get("server")?.toLowerCase() ?? null,
        poweredBy: res.headers.get("x-powered-by")?.toLowerCase() ?? null,
      },
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - start,
      reason: err instanceof Error ? err.message : "unknown error",
    };
  }
}
