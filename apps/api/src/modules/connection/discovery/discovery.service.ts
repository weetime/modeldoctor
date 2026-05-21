import {
  type DiscoverConnectionRequest,
  type DiscoverConnectionResponse,
} from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import { parseCustomHeaders } from "../../../common/http/parse-custom-headers.js";
import { inferCategory } from "./inference/category.js";
import { inferPrometheusUrl } from "./inference/prometheus-url.js";
import { inferServerKind } from "./inference/server-kind.js";
import { inferTags } from "./inference/tags.js";
import { runHealthProbe } from "./probes/health.js";
import type { ProbeResult } from "./probes/index.js";
import { runMetricsProbe } from "./probes/metrics.js";
import { runModelsProbe } from "./probes/models.js";
import { runServerHeaderProbe } from "./probes/server-header.js";
import { assertSafeUrl } from "./ssrf-guard.js";

@Injectable()
export class DiscoveryService {
  async discover(input: DiscoverConnectionRequest): Promise<DiscoverConnectionResponse> {
    const start = Date.now();
    await assertSafeUrl(input.baseUrl);
    const extraHeaders = parseCustomHeaders(input.customHeaders);
    const ctx = { baseUrl: input.baseUrl, apiKey: input.apiKey, extraHeaders };

    const [modelsR, metricsR, healthR, serverHeaderR] = await Promise.all([
      runModelsProbe(ctx),
      runMetricsProbe(ctx),
      runHealthProbe(ctx),
      runServerHeaderProbe(ctx),
    ]);

    const probesFailed = collectFailures({ modelsR, metricsR, healthR, serverHeaderR });
    const warnings = collectWarnings({ modelsR, metricsR, healthR, hasApiKey: !!input.apiKey });

    const serverKind = inferServerKind({ metricsR, serverHeaderR, modelsR });
    const models = inferModelsField(modelsR);
    const category = inferCategory({ models: models.values });
    const gatewayHints = deriveGatewayHints(serverHeaderR);
    const suggestedTags = inferTags({
      serverKind: serverKind.value,
      category: category.value,
      models: models.values,
      gatewayHints,
    });
    const prometheusUrl = inferPrometheusUrl({ baseUrl: input.baseUrl, metricsR });

    return {
      health: {
        durationMs: Date.now() - start,
        probesAttempted: 4,
        probesFailed,
        warnings,
      },
      inferred: {
        serverKind,
        models,
        category,
        suggestedTags,
        prometheusUrl,
      },
    };
  }
}

function collectFailures(results: {
  modelsR: ProbeResult<unknown>;
  metricsR: ProbeResult<unknown>;
  healthR: ProbeResult<unknown>;
  serverHeaderR: ProbeResult<unknown>;
}): Array<{ probe: string; reason: string }> {
  const out: Array<{ probe: string; reason: string }> = [];
  for (const [probe, result] of Object.entries(results)) {
    if (!result.ok) {
      out.push({ probe: probe.replace(/R$/, ""), reason: result.reason ?? "unknown" });
    }
  }
  return out;
}

function collectWarnings(args: {
  modelsR: ProbeResult<unknown>;
  metricsR: ProbeResult<unknown>;
  healthR: ProbeResult<unknown>;
  hasApiKey: boolean;
}): string[] {
  const warnings: string[] = [];
  // Common case: apiKey provided, /v1/models returns 401, but /health OK → key likely wrong
  if (
    args.hasApiKey &&
    !args.modelsR.ok &&
    args.modelsR.reason?.includes("401") &&
    args.healthR.ok
  ) {
    warnings.push("apiKey was provided but /v1/models returned 401 — verify the key is valid");
  }
  return warnings;
}

/**
 * Map known gateway server-header substrings to a stable hint identifier.
 * The hints become free-form tags on the Connection — they do NOT pollute
 * `serverKind` (gateways aren't engines; see connection.ts header).
 *
 * `istio-envoy` and bare `envoy` both map to `higress` because Higress's
 * data plane is Envoy-based and that's the gateway product we explicitly
 * integrate with. A plain Istio gateway also shows `Server: istio-envoy`;
 * the hint is best-effort and the operator can remove the tag if it's
 * wrong for their deployment.
 */
const GATEWAY_HEADER_MAP: Array<[string, string]> = [
  ["higress", "higress"],
  ["istio-envoy", "higress"],
  ["envoy", "higress"],
];

function deriveGatewayHints(
  serverHeaderR: ProbeResult<{ server: string | null; poweredBy: string | null }>,
): string[] {
  if (!serverHeaderR.ok || !serverHeaderR.data) return [];
  const haystack = [serverHeaderR.data.server, serverHeaderR.data.poweredBy]
    .filter((s): s is string => !!s)
    .join(" ");
  if (!haystack) return [];
  const hints = new Set<string>();
  for (const [keyword, hint] of GATEWAY_HEADER_MAP) {
    if (haystack.includes(keyword)) hints.add(hint);
  }
  return Array.from(hints);
}

function inferModelsField(modelsR: ProbeResult<{ models: string[]; raw: unknown }>): {
  values: string[];
  confidence: "certain" | "likely" | "guess" | "unknown";
  evidence: string;
} {
  if (modelsR.ok && modelsR.data) {
    return {
      values: modelsR.data.models,
      confidence: "certain",
      evidence: `${modelsR.data.models.length} model(s) from /v1/models`,
    };
  }
  return {
    values: [],
    confidence: "unknown",
    evidence: modelsR.reason ?? "models probe failed",
  };
}
