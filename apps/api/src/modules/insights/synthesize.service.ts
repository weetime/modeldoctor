// apps/api/src/modules/insights/synthesize.service.ts
import {
  narrativeFindingSchema,
  type NarrativeFinding,
  type SynthesizeRequest,
  type SynthesizeResponse,
} from "@modeldoctor/contracts";
import { Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { z } from "zod";
import { PrismaService } from "../../database/prisma.service.js";
import { LlmJudgeService } from "../llm-judge/llm-judge.service.js";
import { LruCache } from "./cache.js";
import { ComparisonService } from "./comparison.service.js";
import { EvaluationProfileService } from "./evaluation-profile.service.js";
import { chatCompletion } from "./llm-client.js";

const SYS_PROMPT_ZH = `你是一位 LLM 服务性能顾问。给定一个模型连接在指定时间范围内的基准测试数据，
你需要：
1. 找出 3-5 个最值得用户关注的问题（按严重性排序）
2. 每个问题给出：标题、量化的指标根因、可执行的建议（1-3 步）
3. 仅基于提供的数据推断；不要编造未提供的数字
4. 用户的业务画像 (profile) 会影响"严重"的标准 — 优先采用 profile 视角
5. 全部使用简体中文输出。

输出 JSON：
{
  "findings": [
    {
      "severity": "critical" | "warning" | "info",
      "title": "<short>",
      "rootCause": "<2-3 sentences quoting metrics>",
      "recommendations": ["<step 1>", "<step 2>"]
    }
  ]
}`;

const SYS_PROMPT_EN = `You are an LLM serving performance advisor. Given benchmark data for one model connection over a time window, you must:
1. Identify the 3-5 issues the user should care about most (ordered by severity).
2. For each issue, provide: a short title, a quantified root cause that quotes specific metrics, and 1-3 actionable recommendations.
3. Only infer from the data provided; never invent numbers.
4. The user's business profile shifts what counts as "severe" — prefer the profile's viewpoint.
5. Respond entirely in English.

Output JSON:
{
  "findings": [
    {
      "severity": "critical" | "warning" | "info",
      "title": "<short>",
      "rootCause": "<2-3 sentences quoting metrics>",
      "recommendations": ["<step 1>", "<step 2>"]
    }
  ]
}`;

function systemPrompt(locale: SynthesizeRequest["locale"]): string {
  return locale === "en-US" ? SYS_PROMPT_EN : SYS_PROMPT_ZH;
}

const responseSchema = z.object({
  findings: z.array(narrativeFindingSchema).min(0).max(10),
});

const TTL_MS = 24 * 60 * 60 * 1000;
const CAP = 100;

interface CacheEntry {
  generatedAt: string;
  runIdsHash: string;
  findings: NarrativeFinding[];
}

@Injectable()
export class SynthesizeService {
  private cache = new LruCache<string, CacheEntry>(CAP, { ttlMs: TTL_MS });

  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: EvaluationProfileService,
    private readonly comparison: ComparisonService,
    private readonly judge: LlmJudgeService,
  ) {}

  async synthesize(userId: string, connectionId: string, body: SynthesizeRequest): Promise<SynthesizeResponse> {
    const provider = await this.judge.getDecrypted(userId);
    if (!provider || !provider.enabled) throw new NotFoundException("LLM provider not configured or disabled");

    const runs = body.runIds.length > 0
      ? await this.prisma.benchmark.findMany({
          where: { userId, id: { in: body.runIds } },
          select: { id: true, completedAt: true, createdAt: true, scenario: true, tool: true, status: true, summaryMetrics: true, name: true, params: true },
        })
      : [];
    const runIdsHash = createHash("sha256")
      .update(runs.map((r) => `${r.id}:${(r.completedAt ?? r.createdAt).toISOString()}`).sort().join(","))
      .digest("hex");

    const cacheKey = `${userId}:${connectionId}:${body.profileSlug}:${body.range}:${body.locale}:${runIdsHash}`;
    const hit = this.cache.get(cacheKey);
    if (hit) return { findings: hit.findings, generatedAt: hit.generatedAt, runIdsHash, fromCache: true };

    const profile = await this.profiles.getBySlug(body.profileSlug);
    const conn = await this.prisma.connection.findFirst({ where: { id: connectionId, userId } });
    if (!conn) throw new NotFoundException("connection");

    const fromISO = new Date(Date.now() - days(body.range) * 86_400_000).toISOString();
    const baseline = await this.comparison.baseline(userId, connectionId, fromISO);
    const fleet = await this.comparison.fleet(userId, connectionId, fromISO);

    const userPrompt = JSON.stringify({
      connection: { name: conn.name, model: conn.model, category: conn.category },
      profile: { slug: profile.slug, name: profile.name, rationale: profile.source },
      timeRange: { from: fromISO, to: new Date().toISOString() },
      runCount: runs.length,
      profileRules: profile.rules,
      baselineComparison: baseline,
      fleetComparison: fleet,
    });

    let raw: string;
    try {
      const r = await chatCompletion(
        { baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: provider.model },
        [{ role: "system", content: systemPrompt(body.locale) }, { role: "user", content: userPrompt }],
        { jsonMode: true, timeoutMs: 30_000 },
      );
      raw = r.content;
    } catch (e: any) {
      throw new ServiceUnavailableException(`LLM error: ${String(e?.message ?? e).slice(0, 300)}`);
    }

    let parsed;
    try {
      parsed = responseSchema.parse(JSON.parse(raw));
    } catch {
      throw new ServiceUnavailableException("LLM returned malformed JSON");
    }

    const generatedAt = new Date().toISOString();
    this.cache.set(cacheKey, { generatedAt, runIdsHash, findings: parsed.findings });
    return { findings: parsed.findings, generatedAt, runIdsHash, fromCache: false };
  }

  invalidate(userId: string, connectionId: string): void {
    this.cache.deleteByPrefix(`${userId}:${connectionId}:`);
  }
}

function days(r: SynthesizeRequest["range"]): number {
  return ({ "7d": 7, "30d": 30, "90d": 90 } as const)[r];
}
