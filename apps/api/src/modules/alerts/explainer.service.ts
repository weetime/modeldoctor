import { Injectable, Logger } from "@nestjs/common";
import type { AlertEvent, Prisma } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../../database/prisma.service.js";
import { chatCompletion } from "../insights/llm-client.js";
import { LlmJudgeService } from "../llm-judge/llm-judge.service.js";
import type { EventType } from "../notifications/subscriptions.service.js";
import { type PromContext, PrometheusFetcherService } from "./prometheus-fetcher.service.js";
import { SubscribersService } from "./subscribers.service.js";

// AI-generated narrative shape. Stored as JSON in alert_explanations.recommendations,
// markdown narrative in narrative column.
const explanationResponseSchema = z.object({
  ai_severity: z.enum(["critical", "warning", "info"]),
  narrative: z.string().min(20),
  recommendations: z.array(z.string()).min(1).max(5),
});

// AI narrative is zh-CN only for V1 (per CLAUDE.md "Insights & AI judge"
// section). Narrative is returned as plain-text paragraphs (no markdown
// syntax) since the alert-detail UI renders it with `whitespace-pre-wrap`
// and we don't carry a markdown parser on the web side yet.
const SYS_PROMPT_ZH = `你是 LLM 推理服务的资深运维顾问。给定一条 Prometheus 告警 + 该连接的历史 benchmark + 已设基线,你需要:

1. 用 2-4 段中文**纯文本**解释这次告警的可能根因。段落之间空一行。不要使用 markdown 标记(**、## 、\`code\` 等),也不要写列表或表格 —— 段落叙事即可。**只基于提供的数据推断**,不要编造未提供的数字。
2. 给出 1-5 条可执行的处置建议(从最紧急到次紧急),每条一句话。
3. 重新评估严重程度 (critical / warning / info) — Prometheus 标的可能偏严或偏松,你根据上下文判断。

如果给了"告警时段指标"段,优先用其中的真实数据点支撑结论;未提供时只基于 baseline / benchmark 推断,不要编数字。

输出 JSON:
{
  "ai_severity": "critical" | "warning" | "info",
  "narrative": "<纯文本,2-4 段,段落间空一行>",
  "recommendations": ["<step 1>", "<step 2>", ...]
}`;

interface BuiltContext {
  baseline: Record<string, unknown> | null;
  recentBenchmarks: Array<{ id: string; createdAt: string; metrics: unknown }>;
  promSnapshot: PromContext | null;
}

@Injectable()
export class AlertExplainerService {
  private readonly log = new Logger(AlertExplainerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly judge: LlmJudgeService,
    private readonly subscribers: SubscribersService,
    private readonly promFetcher: PrometheusFetcherService,
  ) {}

  /**
   * Fire-and-forget explainer. Caller awaits only to attach error handler;
   * the result lives in `alert_explanations` for the UI to pick up.
   *
   * No-op (warn only) when no LLM judge is configured — the alert itself
   * is still useful without narrative.
   */
  async explainAsync(alertEventId: string): Promise<void> {
    const judge = await this.judge.getDecrypted();
    if (!judge?.enabled) {
      this.log.debug(`No LLM judge configured; skipping explanation for ${alertEventId}`);
      return;
    }

    // Pull the full AlertEvent row — the Prometheus fetcher needs
    // `rawPayload.generatorURL` as a fallback when annotations.expr is absent,
    // and the snapshot logic is keyed off startsAt + connectionId regardless.
    const event = await this.prisma.alertEvent.findUnique({
      where: { id: alertEventId },
    });
    if (!event) {
      this.log.warn(`AlertEvent ${alertEventId} not found for explanation`);
      return;
    }

    const context = await this.buildContext(event);
    const prompt = this.buildPrompt(event, context);

    const t0 = Date.now();
    let parsed: z.infer<typeof explanationResponseSchema>;
    try {
      const res = await chatCompletion(
        { baseUrl: judge.baseUrl, apiKey: judge.apiKey, model: judge.model },
        [
          { role: "system", content: SYS_PROMPT_ZH },
          { role: "user", content: prompt },
        ],
        { jsonMode: true, timeoutMs: 60_000 },
      );
      parsed = explanationResponseSchema.parse(JSON.parse(res.content));
    } catch (err) {
      this.log.error(`Explainer LLM call failed for ${alertEventId}: ${(err as Error).message}`);
      return;
    }
    const latencyMs = Date.now() - t0;

    await this.prisma.alertExplanation.create({
      data: {
        alertEventId,
        narrative: parsed.narrative,
        recommendations: parsed.recommendations as Prisma.InputJsonValue,
        aiSeverity: parsed.ai_severity,
        llmProvider: judge.id,
        llmModel: judge.model,
        latencyMs,
      },
    });

    this.log.log(
      `Explanation generated for alert ${alertEventId} severity=${parsed.ai_severity} latency=${latencyMs}ms`,
    );

    await this.emitNotification(alertEventId, parsed.ai_severity);
  }

  // Test-only accessors. The prompt-shape assertions live in the unit spec
  // and don't need to round-trip through the LLM; exposing the two builders
  // keeps that coverage cheap without making the production surface wider.
  _test_buildContext(event: AlertEvent) {
    return this.buildContext(event);
  }
  _test_buildPrompt(event: AlertEvent, context: BuiltContext) {
    return this.buildPrompt(event, context);
  }

  /**
   * Pull baseline + last few benchmarks for the connection (if any) plus a
   * Prometheus snapshot around the alert's startsAt so the LLM can reason
   * about regression vs absolute alert and ground claims on real datapoints.
   *
   * Each enrichment is best-effort: Prom fetch failures degrade to `null` and
   * the narrative falls back to baseline-only reasoning (see SYS_PROMPT_ZH).
   */
  private async buildContext(event: AlertEvent): Promise<BuiltContext> {
    const promSnapshot = await this.promFetcher.fetchAlertContext(event);
    if (!event.connectionId) {
      return { baseline: null, recentBenchmarks: [], promSnapshot };
    }
    const baseline = await this.prisma.baseline.findFirst({
      where: { active: true, benchmark: { connectionId: event.connectionId } },
      include: {
        benchmark: { select: { id: true, summaryMetrics: true, createdAt: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    const recent = await this.prisma.benchmark.findMany({
      where: { connectionId: event.connectionId, status: "completed" },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { id: true, createdAt: true, summaryMetrics: true },
    });
    return {
      baseline: baseline
        ? {
            name: baseline.name,
            createdAt: baseline.createdAt.toISOString(),
            metrics: baseline.benchmark.summaryMetrics,
          }
        : null,
      recentBenchmarks: recent.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        metrics: r.summaryMetrics,
      })),
      promSnapshot,
    };
  }

  private buildPrompt(event: AlertEvent, context: BuiltContext): string {
    const sections = [
      "## 告警",
      `- 名称: ${event.alertName}`,
      `- 严重度 (Prometheus 标): ${event.severity}`,
      `- 场景: ${event.scenario ?? "未分类"}`,
      `- 状态: ${event.status}`,
      `- 开始时间: ${event.startsAt.toISOString()}`,
      "",
      "## Labels",
      `\`\`\`json\n${JSON.stringify(event.labels, null, 2)}\n\`\`\``,
      "",
      "## Annotations",
      `\`\`\`json\n${JSON.stringify(event.annotations, null, 2)}\n\`\`\``,
    ];

    if (context.baseline) {
      sections.push(
        "",
        "## 当前基线",
        `\`\`\`json\n${JSON.stringify(context.baseline, null, 2)}\n\`\`\``,
      );
    } else {
      sections.push("", "## 当前基线", "_未设_");
    }

    if (context.recentBenchmarks.length > 0) {
      sections.push(
        "",
        `## 最近 ${context.recentBenchmarks.length} 次 benchmark`,
        `\`\`\`json\n${JSON.stringify(context.recentBenchmarks, null, 2)}\n\`\`\``,
      );
    }

    if (context.promSnapshot) {
      const snap = context.promSnapshot;
      sections.push(
        "",
        `## 告警时段指标(数据源: ${snap.datasource.name})`,
        `- expr: \`${snap.expr}\``,
        `- 窗口: ${snap.window.start} → ${snap.window.end}, step=${snap.window.stepSeconds}s`,
        `- 命中 series 数: ${snap.series.length}`,
        "",
        ...snap.series.flatMap((s) => [
          `labels: ${JSON.stringify(s.labels)}`,
          `summary: min=${s.summary.min.toFixed(3)}, max=${s.summary.max.toFixed(3)}, mean=${s.summary.mean.toFixed(3)}, last=${s.summary.last.toFixed(3)}`,
          "samples:",
          ...s.samples.map((p) => `  - ${p.at}  ${p.value}`),
          "",
        ]),
      );
    }

    return sections.join("\n");
  }

  /**
   * Fan out alert.explained deliveries to every ConnectionSubscriber
   * whose minSeverity floor is met by the alert's AI-assessed severity.
   *
   * No-op when the alert has no inferred connection (we have no
   * subscriber set to query in that case).
   */
  private async emitNotification(alertEventId: string, severity: string): Promise<void> {
    const event = await this.prisma.alertEvent.findUnique({
      where: { id: alertEventId },
      include: {
        connection: { select: { id: true, name: true } },
        explanation: { select: { narrative: true } },
      },
    });
    if (!event?.connection) {
      this.log.debug(`Alert ${alertEventId} has no inferred connection; skipping notification`);
      return;
    }

    const matched = await this.subscribers.findMatching(event.connection.id, severity);
    if (matched.length === 0) {
      this.log.debug(
        `No subscribers passing severity=${severity} for connection ${event.connection.id}`,
      );
      return;
    }

    await this.prisma.notificationDelivery.createMany({
      data: matched.map((s) => ({
        channelId: s.channelId,
        eventType: "alert.explained" satisfies EventType,
        payload: {
          alertEventId,
          alertName: event.alertName,
          connectionId: event.connection?.id,
          connectionName: event.connection?.name,
          severity,
          scenario: event.scenario,
          narrative: event.explanation?.narrative ?? "",
        } as Prisma.InputJsonValue,
      })),
    });
    this.log.log(`Queued ${matched.length} deliveries for alert.explained alert=${alertEventId}`);
  }
}
