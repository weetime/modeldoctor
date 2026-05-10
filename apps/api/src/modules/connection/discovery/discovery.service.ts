import {
  type DiscoverConnectionRequest,
  type DiscoverConnectionResponse,
} from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
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
    const ctx = { baseUrl: input.baseUrl, apiKey: input.apiKey };

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
    const suggestedTags = inferTags({
      serverKind: serverKind.value,
      category: category.value,
      models: models.values,
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
