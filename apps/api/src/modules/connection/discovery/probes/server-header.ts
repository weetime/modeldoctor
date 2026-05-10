import { safeFetch } from "../safe-fetch.js";
import type { ProbeCtx, ProbeResult, ServerHeaderProbeData } from "./index.js";

export async function runServerHeaderProbe(
  ctx: ProbeCtx,
): Promise<ProbeResult<ServerHeaderProbeData>> {
  const start = Date.now();
  try {
    const res = await safeFetch(`${ctx.baseUrl.replace(/\/+$/, "")}/`, {
      extraHeaders: ctx.extraHeaders,
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
