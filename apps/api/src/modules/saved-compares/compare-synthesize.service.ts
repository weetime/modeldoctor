import { createHash } from "node:crypto";
import {
  type CompareNarrative,
  type CompareSynthesizeRequest,
  type CompareSynthesizeResponse,
  compareNarrativeSchema,
  type HydratedSavedCompare,
} from "@modeldoctor/contracts";
import { Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { LruCache } from "../insights/cache.js";
import { chatCompletion } from "../insights/llm-client.js";
import { LlmJudgeService } from "../llm-judge/llm-judge.service.js";
import { summarizeForPrompt } from "./metrics.js";
import { COMPARE_SYS_PROMPT_EN, COMPARE_SYS_PROMPT_ZH } from "./prompts.js";
import { SavedComparesService } from "./saved-compares.service.js";

interface CacheEntry {
  generatedAt: string;
  narrative: CompareNarrative;
}

const TTL_MS = 24 * 60 * 60 * 1000;
const CAP = 100;

@Injectable()
export class CompareSynthesizeService {
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

    const userPrompt = this.buildUserPrompt(sc, body.locale);
    const sys = body.locale === "en-US" ? COMPARE_SYS_PROMPT_EN : COMPARE_SYS_PROMPT_ZH;

    let raw: string;
    try {
      const out = await chatCompletion(
        { baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: provider.model },
        [
          { role: "system", content: sys },
          { role: "user", content: userPrompt },
        ],
        { jsonMode: true, timeoutMs: 30_000 },
      );
      raw = out.content;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new ServiceUnavailableException(`LLM error: ${msg.slice(0, 300)}`);
    }

    let parsed: CompareNarrative;
    try {
      parsed = compareNarrativeSchema.parse(JSON.parse(this.extractJson(raw)));
    } catch {
      throw new ServiceUnavailableException("LLM returned invalid JSON");
    }

    const generatedAt = new Date();
    await this.svc.setNarrative(id, parsed, generatedAt);
    this.cache.set(key, { generatedAt: generatedAt.toISOString(), narrative: parsed });

    return { narrative: parsed, generatedAt: generatedAt.toISOString(), fromCache: false };
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

  private buildUserPrompt(sc: HydratedSavedCompare, locale: string): string {
    const zh = locale !== "en-US";
    const L = {
      context: zh ? "背景" : "Context",
      runs: zh ? "基准运行" : "Runs",
      deleted: zh ? "(数据已删除)" : "(data deleted)",
      baseline: zh ? "基线阶段" : "Baseline stage",
      jsonReminder: zh
        ? "严格按 JSON schema 输出。"
        : "Respond strictly as JSON matching the schema.",
    };
    const lines: string[] = [];
    if (sc.context) lines.push(`${L.context}: ${sc.context}`);
    if (sc.benchmarks.length > 0) {
      lines.push(`${L.runs} (${sc.benchmarks.length}):`);
    }
    for (const b of sc.benchmarks) {
      if (b.missing) {
        lines.push(`- [${b.stageLabel}] ${L.deleted}`);
        continue;
      }
      const m = summarizeForPrompt(b.summaryMetrics);
      lines.push(
        `- [${b.stageLabel}] ${b.tool}/${b.scenario}: ` +
          `qps=${m.throughput ?? "—"} err=${m.errorRate ?? "—"} ` +
          `ttft p50/p90/p99=${m.ttft?.p50 ?? "—"}/${m.ttft?.p90 ?? "—"}/${m.ttft?.p99 ?? "—"} ` +
          `e2e p50/p90/p99=${m.e2e?.p50 ?? "—"}/${m.e2e?.p90 ?? "—"}/${m.e2e?.p99 ?? "—"}`,
      );
    }
    if (sc.baselineId) {
      const bl = sc.benchmarks.find((b) => b.id === sc.baselineId);
      if (bl) lines.push(`${L.baseline}: ${bl.stageLabel}`);
    }
    lines.push(L.jsonReminder);
    return lines.join("\n");
  }

  private extractJson(content: string): string {
    const trimmed = content.trim();
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    return fence ? fence[1].trim() : trimmed;
  }
}
