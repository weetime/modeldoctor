import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../../database/prisma.service.js";
import { chatCompletion } from "../insights/llm-client.js";
import { LlmJudgeService } from "../llm-judge/llm-judge.service.js";
import type { EventType } from "../notifications/subscriptions.service.js";

// AI-generated narrative shape. Stored as JSON in alert_explanations.recommendations,
// markdown narrative in narrative column.
const explanationResponseSchema = z.object({
  ai_severity: z.enum(["critical", "warning", "info"]),
  narrative: z.string().min(20),
  recommendations: z.array(z.string()).min(1).max(5),
});

const SYS_PROMPT_ZH = `你是 LLM 推理服务的资深运维顾问。给定一条 Prometheus 告警 + 该连接的历史 benchmark + 已设基线,你需要:

1. 用 2-4 段中文 markdown 解释这次告警的可能根因。**只基于提供的数据推断**,不要编造未提供的数字。
2. 给出 1-5 条可执行的处置建议(从最紧急到次紧急)。
3. 重新评估严重程度 (critical / warning / info) — Prometheus 标的可能偏严或偏松,你根据上下文判断。

输出 JSON:
{
  "ai_severity": "critical" | "warning" | "info",
  "narrative": "<markdown,2-4 段>",
  "recommendations": ["<step 1>", "<step 2>", ...]
}`;

interface AlertContext {
  alertName: string;
  severity: string;
  scenario: string | null;
  status: string;
  labels: Record<string, unknown>;
  annotations: Record<string, unknown>;
  startsAt: Date;
  connectionId: string | null;
}

@Injectable()
export class AlertExplainerService {
  private readonly log = new Logger(AlertExplainerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly judge: LlmJudgeService,
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
    if (!judge || !judge.enabled) {
      this.log.debug(`No LLM judge configured; skipping explanation for ${alertEventId}`);
      return;
    }

    const event = await this.prisma.alertEvent.findUnique({
      where: { id: alertEventId },
      select: {
        id: true,
        alertName: true,
        severity: true,
        scenario: true,
        status: true,
        labels: true,
        annotations: true,
        startsAt: true,
        connectionId: true,
      },
    });
    if (!event) {
      this.log.warn(`AlertEvent ${alertEventId} not found for explanation`);
      return;
    }

    const context = await this.buildContext(event as AlertContext);
    const prompt = this.buildPrompt(event as AlertContext, context);

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

  /**
   * Pull baseline + last few benchmarks for the connection (if any) so the
   * LLM can reason about regression vs absolute alert.
   */
  private async buildContext(event: AlertContext): Promise<{
    baseline: Record<string, unknown> | null;
    recentBenchmarks: Array<{ id: string; createdAt: string; metrics: unknown }>;
  }> {
    if (!event.connectionId) {
      return { baseline: null, recentBenchmarks: [] };
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
    };
  }

  private buildPrompt(
    event: AlertContext,
    context: {
      baseline: Record<string, unknown> | null;
      recentBenchmarks: Array<{ id: string; createdAt: string; metrics: unknown }>;
    },
  ): string {
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

    return sections.join("\n");
  }

  /**
   * Fire alert.explained event so users subscribed to this connection's
   * alerts are notified. Subscriber model for v1 is minimal: we look up the
   * Connection.userId as the owner and notify them. Multi-subscriber +
   * severity-routing is roadmap follow-up.
   */
  private async emitNotification(alertEventId: string, severity: string): Promise<void> {
    const event = await this.prisma.alertEvent.findUnique({
      where: { id: alertEventId },
      include: {
        connection: { select: { id: true, userId: true, name: true } },
        explanation: { select: { narrative: true } },
      },
    });
    if (!event?.connection) {
      this.log.debug(`Alert ${alertEventId} has no inferred connection; skipping notification`);
      return;
    }

    // Find subscriptions for this connection (filter.connectionId match) on
    // the alert.explained event type. We don't go through NotifyService
    // because EventType is a string-union without alert.* members today;
    // adding directly to NotificationDelivery keeps the change footprint
    // small for v1.
    const subs = await this.prisma.notificationSubscription.findMany({
      where: {
        eventType: "alert.explained",
        channel: { userId: event.connection.userId },
      },
    });
    const matched = subs.filter((s) => {
      const f = s.filter as { connectionId?: string } | null;
      if (!f?.connectionId) return true;
      return f.connectionId === event.connection?.id;
    });
    if (matched.length === 0) {
      this.log.debug(`No subscribers for alert.explained on connection ${event.connection.id}`);
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
