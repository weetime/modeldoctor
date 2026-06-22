import { createHash } from "node:crypto";
import {
  type CompareNarrative,
  type CompareSynthesizeRequest,
  type CompareSynthesizeResponse,
  compareNarrativeSchema,
  type HydratedSavedCompare,
} from "@modeldoctor/contracts";
import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { LruCache } from "../insights/cache.js";
import { type ChatMessage, chatCompletion } from "../insights/llm-client.js";
import { LlmJudgeService } from "../llm-judge/llm-judge.service.js";
import { availableFigureRefIds, readPrefixCache, summarizeForPrompt } from "./metrics.js";
import { isBlockingWarning, lintNarrative } from "./narrative-lint.js";
import { buildRetryFeedback, buildSystemPrompt } from "./prompts.js";
import { getReportProfile, resolveReportIntent } from "./report-scenarios/index.js";
import type { ScenarioData } from "./report-scenarios/types.js";
import { SavedComparesService } from "./saved-compares.service.js";

interface CacheEntry {
  generatedAt: string;
  narrative: CompareNarrative;
}

const TTL_MS = 24 * 60 * 60 * 1000;
const CAP = 100;
// Deep report — up to ~30k output tokens via a beefy model. The Nest HTTP
// handler timeout is lifted in main.ts so the full window is reachable.
const LLM_TIMEOUT_MS = 180_000;

@Injectable()
export class CompareSynthesizeService {
  private readonly log = new Logger(CompareSynthesizeService.name);
  private cache = new LruCache<string, CacheEntry>(CAP, { ttlMs: TTL_MS });

  constructor(
    private readonly svc: SavedComparesService,
    private readonly llmJudge: LlmJudgeService,
  ) {}

  async synthesize(
    userId: string,
    id: string,
    body: CompareSynthesizeRequest,
  ): Promise<CompareSynthesizeResponse> {
    const sc = await this.svc.getHydrated(userId, id);
    if (!sc) throw new NotFoundException("SavedCompare not found");

    const provider = await this.llmJudge.getDecrypted();
    if (!provider?.enabled) {
      throw new ServiceUnavailableException("LLM provider not configured");
    }

    const key = this.cacheKey(sc, body.locale);
    const hit = this.cache.get(key);
    if (hit) {
      return { narrative: hit.narrative, generatedAt: hit.generatedAt, fromCache: true };
    }

    const runCount = sc.benchmarks.filter((b) => !b.missing).length;
    const intent = resolveReportIntent(sc.scenario, runCount);
    const profile = getReportProfile(intent);
    const scenarioData = profile.dataAssembly(sc);
    const sys = buildSystemPrompt(body.locale, profile.promptFragment(body.locale));
    const userPrompt = this.buildUserPrompt(sc, body.locale, scenarioData);

    // First attempt
    let parsed = await this.callAndParse(provider, body.locale, [
      { role: "system", content: sys },
      { role: "user", content: userPrompt },
    ]);

    // Lint pass + one retry on blocking warnings
    let warnings = lintNarrative(parsed, this.collectInputNumbers(sc));
    const blocking = warnings.filter((w) => isBlockingWarning(w.code));
    if (blocking.length > 0) {
      this.log.warn(
        `compare-synthesize ${id}: ${blocking.length} blocking warnings on first attempt, retrying`,
      );
      const retryUser = `${userPrompt}\n\n${buildRetryFeedback(body.locale, blocking)}`;
      const retried = await this.callAndParse(provider, body.locale, [
        { role: "system", content: sys },
        { role: "user", content: retryUser },
      ]);
      const retriedWarnings = lintNarrative(retried, this.collectInputNumbers(sc));
      // Accept retry even if some warnings remain — it's still an improvement
      // signal, and forcing a 3rd round on flaky rules wastes tokens.
      parsed = retried;
      warnings = retriedWarnings;
    }

    parsed = {
      ...parsed,
      hero: this.augmentHero(parsed.hero, sc),
      figures: this.ensurePrefixCacheFigures(parsed.figures, sc, body.locale),
      lintWarnings: warnings,
    };

    const generatedAt = new Date();
    await this.svc.setNarrative(id, parsed, generatedAt);
    this.cache.set(key, { generatedAt: generatedAt.toISOString(), narrative: parsed });

    return { narrative: parsed, generatedAt: generatedAt.toISOString(), fromCache: false };
  }

  /**
   * Guarantee the prefix-cache hit-rate figure is present when the data
   * supports it. Hit rate is the metric a lb-strategy comparison
   * exists to measure, but it isn't in the throughput/latency blob the LLM
   * fixates on, so weaker models routinely omit it. When the refId is
   * available and the LLM didn't include it, inject it (anchored to results)
   * — same server-control pattern as augmentHero. Does nothing for
   * non-prefix-cache comparisons (refId simply isn't available).
   */
  private ensurePrefixCacheFigures(
    figures: CompareNarrative["figures"],
    sc: HydratedSavedCompare,
    locale: string,
  ): CompareNarrative["figures"] {
    const available = availableFigureRefIds(
      sc.benchmarks
        .filter((b) => !b.missing)
        .map((b) => ({ summaryMetrics: b.summaryMetrics, serverMetrics: b.serverMetrics, hasLatencyCdf: !!b.latencyCdf })),
    );
    if (!available.has("stage-bars-prefix-cache-hit")) return figures;
    if (figures.some((f) => f.refId === "stage-bars-prefix-cache-hit")) return figures;
    const zh = locale !== "en-US";
    const figure = {
      id: "fig-prefix-cache-hit",
      refId: "stage-bars-prefix-cache-hit" as const,
      caption: zh
        ? "各 stage 的 prefix cache 命中率（越高越好）"
        : "Prefix cache hit rate by stage (higher is better)",
      anchorSection: "results" as const,
    };
    // compareNarrativeSchema caps figures at 8. Appending a 9th would fail the
    // zod parse on setNarrative / read-back → 500. Reserve our slot by dropping
    // the LLM's last figure when full, rather than slicing our own injected
    // figure off the end (hit rate is the whole point of this comparison).
    return [...figures.slice(0, 7), figure];
  }

  /**
   * Prepend server-controlled meta items to whatever the LLM emitted, so the
   * Hero always reflects the SavedCompare row's classification / client /
   * version regardless of whether the prompt taught the model about them.
   * Caps at 8 total meta items (schema limit).
   */
  private augmentHero(
    hero: CompareNarrative["hero"],
    sc: HydratedSavedCompare,
  ): CompareNarrative["hero"] {
    // setNarrative bumps version after this call, so display = stored + 1.
    const nextVersion = sc.version + 1;
    const serverMeta: CompareNarrative["hero"]["metaItems"] = [
      { label: "Classification", value: sc.classification },
      ...(sc.clientName ? [{ label: "Client", value: sc.clientName }] : []),
      { label: "Version", value: `v${nextVersion}` },
    ];
    // Dedupe by label (case-insensitive): server meta wins.
    const serverLabels = new Set(serverMeta.map((m) => m.label.toLowerCase()));
    const llmMeta = hero.metaItems.filter((m) => !serverLabels.has(m.label.toLowerCase()));
    return { ...hero, metaItems: [...serverMeta, ...llmMeta].slice(0, 8) };
  }

  private async callAndParse(
    provider: { baseUrl: string; apiKey: string; model: string },
    _locale: "zh-CN" | "en-US",
    messages: ChatMessage[],
  ): Promise<CompareNarrative> {
    let raw: string;
    try {
      const out = await chatCompletion(
        { baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: provider.model },
        messages,
        { jsonMode: true, timeoutMs: LLM_TIMEOUT_MS },
      );
      raw = out.content;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new ServiceUnavailableException(`LLM error: ${msg.slice(0, 300)}`);
    }

    try {
      const json = JSON.parse(this.extractJson(raw));
      // LLM may omit lintWarnings; fill it in before zod parse to keep the
      // model happy without lying about contents.
      if (json && typeof json === "object" && !("lintWarnings" in json)) {
        (json as { lintWarnings: unknown[] }).lintWarnings = [];
      }
      return compareNarrativeSchema.parse(json);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new ServiceUnavailableException(
        `LLM returned invalid narrative JSON: ${msg.slice(0, 300)}`,
      );
    }
  }

  /**
   * Walk the input metrics summary and collect every number the LLM could
   * legitimately cite. Used by lint number cross-check (lint module reads this
   * as a soft signal — caller still trusts the LLM for derivative ratios).
   */
  private collectInputNumbers(sc: HydratedSavedCompare): number[] {
    const nums: number[] = [];
    for (const b of sc.benchmarks) {
      if (b.missing) continue;
      const m = summarizeForPrompt(b.summaryMetrics);
      if (m.throughput !== null) nums.push(m.throughput);
      if (m.errorRate !== null) nums.push(m.errorRate);
      if (m.ttft) {
        for (const v of [m.ttft.p50, m.ttft.p90, m.ttft.p99]) {
          if (v !== null) nums.push(v);
        }
      }
      if (m.e2e) {
        for (const v of [m.e2e.p50, m.e2e.p90, m.e2e.p99]) {
          if (v !== null) nums.push(v);
        }
      }
      const pc = readPrefixCache(b.serverMetrics);
      if (pc) nums.push(pc.hitRatePct, pc.topPodSharePct);
    }
    return nums;
  }

  private cacheKey(sc: HydratedSavedCompare, locale: string): string {
    const runsDigest = createHash("sha256")
      .update(
        JSON.stringify(
          sc.benchmarks.map((b) => ({
            id: b.id,
            mh: b.missing
              ? null
              : createHash("sha256")
                  .update(JSON.stringify(b.summaryMetrics ?? {}))
                  .digest("hex"),
          })),
        ),
      )
      .digest("hex");
    return createHash("sha256")
      .update(
        JSON.stringify({
          id: sc.id,
          baselineId: sc.baselineId,
          stageLabels: sc.stageLabels,
          context: sc.context,
          runsDigest,
          locale,
        }),
      )
      .digest("hex");
  }

  private buildUserPrompt(
    sc: HydratedSavedCompare,
    locale: string,
    scenarioData: ScenarioData,
  ): string {
    const zh = locale !== "en-US";
    const L = {
      contextHeader: zh ? "## 背景" : "## Context",
      runsHeader: zh ? "## 各 stage 数据" : "## Per-stage data",
      deleted: zh ? "(数据已删除)" : "(data deleted)",
      baselineHeader: zh ? "## 基线" : "## Baseline",
      reminder: zh
        ? "## 任务\n请按 system prompt 描述的 JSON schema 与风格规则输出深度报告。"
        : "## Task\nProduce the deep report following the JSON schema and style rules from the system prompt.",
      metricsLegend: zh
        ? "metric 单位:qps=req/s, err=fraction, ttft/e2e=ms"
        : "metric units: qps=req/s, err=fraction, ttft/e2e=ms",
    };

    const lines: string[] = [];
    if (sc.context) {
      lines.push(L.contextHeader, sc.context, "");
    }
    lines.push(L.runsHeader, L.metricsLegend, "");
    for (const b of sc.benchmarks) {
      if (b.missing) {
        lines.push(`- [${b.stageLabel}] ${L.deleted}`);
        continue;
      }
      const m = summarizeForPrompt(b.summaryMetrics);
      const ttftLine =
        m.ttft === null
          ? "ttft=—"
          : `ttft p50/p90/p99=${m.ttft.p50 ?? "—"}/${m.ttft.p90 ?? "—"}/${m.ttft.p99 ?? "—"}`;
      const e2eLine =
        m.e2e === null
          ? "e2e=—"
          : `e2e p50/p90/p99=${m.e2e.p50 ?? "—"}/${m.e2e.p90 ?? "—"}/${m.e2e.p99 ?? "—"}`;
      const pc = readPrefixCache(b.serverMetrics);
      const pcLine = pc
        ? `  prefix_cache_hit%=${pc.hitRatePct.toFixed(1)}  top_pod_share%=${pc.topPodSharePct.toFixed(1)}`
        : "";
      lines.push(
        `- [${b.stageLabel}] ${b.name ?? "(unnamed)"} · tool=${b.tool ?? "?"} scenario=${b.scenario ?? "?"}`,
        `  qps=${m.throughput ?? "—"}  err=${m.errorRate ?? "—"}  ${ttftLine}  ${e2eLine}${pcLine}`,
      );
    }
    if (sc.baselineId) {
      const bl = sc.benchmarks.find((b) => b.id === sc.baselineId);
      if (bl) {
        lines.push("", L.baselineHeader, `stage ${bl.stageLabel} (id ${bl.id.slice(0, 8)})`);
      }
    }

    if (scenarioData.promptBlock.trim()) {
      lines.push("", scenarioData.promptBlock);
    }

    // Tell the LLM which figure refIds actually have data behind them, so it
    // does not pick a refId for which the bar chart will render empty. Keys
    // outside this list MUST NOT appear in `figures[*].refId`. When the scenario
    // profile expresses a preference, narrow the offered set to its preferred
    // figures (intersected with availability); otherwise offer all available.
    const available = availableFigureRefIds(
      sc.benchmarks
        .filter((b) => !b.missing)
        .map((b) => ({ summaryMetrics: b.summaryMetrics, serverMetrics: b.serverMetrics, hasLatencyCdf: !!b.latencyCdf })),
    );
    const preferred = scenarioData.preferredFigures.filter((r) => available.has(r));
    const offered = preferred.length > 0 ? preferred : [...available];
    lines.push(
      "",
      zh ? "## 可用图表 refId" : "## Available figure refIds",
      zh
        ? "本次数据集仅支持以下 refId,figures[].refId 不得使用此清单外的值:"
        : "Only these refIds may appear in `figures[].refId` — others will render empty:",
      ...offered.map((r) => `- ${r}`),
    );

    lines.push("", L.reminder);
    return lines.join("\n");
  }

  private extractJson(content: string): string {
    const trimmed = content.trim();
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    return fence ? fence[1].trim() : trimmed;
  }
}
