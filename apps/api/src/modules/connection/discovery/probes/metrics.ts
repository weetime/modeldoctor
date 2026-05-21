import { safeFetch } from "../safe-fetch.js";
import type { MetricsProbeData, ProbeCtx, ProbeResult } from "./index.js";

const MAX_BODY_BYTES = 64 * 1024;

// Prometheus exposition-format sample line:
//   metric_name [{label="value",...}] <number> [<timestamp>]
// Metric/label names per spec: first char [a-zA-Z_:], subsequent [a-zA-Z0-9_:].
// Value per spec is a Go ParseFloat-compatible float, including `1.` (trailing
// dot), `.5`, scientific, and the special tokens `NaN`, `+Inf`, `-Inf`, `Inf`
// — vLLM/Python prometheus_client emits NaN for under-observed quantiles, so
// missing those would false-negative a freshly-started engine.
const METRIC_SAMPLE_LINE =
  /^[a-zA-Z_:][a-zA-Z0-9_:]*(\{[^}]*\})? ([+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?|[+-]?Inf|NaN)( \d+)?$/m;
const HELP_OR_TYPE_LINE = /^# (HELP|TYPE) /m;

function looksLikePrometheusExposition(body: string): boolean {
  // # HELP / # TYPE comment lines are unique to the spec and the strongest signal.
  if (HELP_OR_TYPE_LINE.test(body)) return true;
  // Some exporters omit HELP/TYPE; require at least one bare sample line.
  return METRIC_SAMPLE_LINE.test(body);
}

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
    // SPA fallbacks, gateway login pages, and catch-all web routes routinely
    // serve 200 + HTML at /metrics. Downstream inference greps for engine
    // metric prefixes; HTML reliably misses, so it's not unsafe — but the
    // probe pretending to have succeeded is misleading. Verify shape.
    if (!looksLikePrometheusExposition(body)) {
      return {
        ok: false,
        durationMs: Date.now() - start,
        reason: "200 OK but body is not Prometheus exposition format",
      };
    }
    return { ok: true, durationMs: Date.now() - start, data: { body } };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - start,
      reason: err instanceof Error ? err.message : "unknown error",
    };
  }
}
