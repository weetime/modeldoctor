import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";
import type { AlertmanagerAlert, AlertmanagerPayload, ListAlertsQuery } from "./alerts.dto.js";

@Injectable()
export class AlertsService {
  private readonly log = new Logger(AlertsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ingest one Alertmanager webhook POST. Each alert in the payload is
   * upserted by (fingerprint, startsAt) so the same group resent during a
   * sustained firing window does not duplicate rows.
   *
   * Returns the rows that were created OR matched (for downstream explainer
   * triggering on the freshly-created ones).
   */
  async ingest(payload: AlertmanagerPayload): Promise<{ created: string[]; matched: string[] }> {
    const created: string[] = [];
    const matched: string[] = [];

    for (const alert of payload.alerts) {
      const inferred = await this.inferConnection(alert);

      // upsert is the natural fit but Prisma upsert + composite unique +
      // selecting "did we create or match?" is verbose; use a try-create
      // pattern instead.
      const startsAt = new Date(alert.startsAt);
      const existing = await this.prisma.alertEvent.findUnique({
        where: { fingerprint_startsAt: { fingerprint: alert.fingerprint, startsAt } },
        select: { id: true, status: true },
      });

      if (existing) {
        // Same firing-window record. Update status if it transitioned
        // (firing → resolved happens when AM resends with resolved status).
        if (existing.status !== alert.status) {
          await this.prisma.alertEvent.update({
            where: { id: existing.id },
            data: {
              status: alert.status,
              endsAt: alert.endsAt ? new Date(alert.endsAt) : null,
            },
          });
        }
        matched.push(existing.id);
        continue;
      }

      const row = await this.prisma.alertEvent.create({
        data: {
          fingerprint: alert.fingerprint,
          status: alert.status,
          severity: alert.labels.severity ?? "info",
          scenario: alert.labels.modeldoctor_scenario ?? null,
          alertName: alert.labels.alertname ?? "unknown",
          connectionId: inferred?.id ?? null,
          modelName: alert.labels.model_name ?? null,
          engine: alert.labels.engine ?? null,
          instance: alert.labels.instance ?? null,
          labels: alert.labels as Prisma.InputJsonValue,
          annotations: alert.annotations as Prisma.InputJsonValue,
          rawPayload: alert as unknown as Prisma.InputJsonValue,
          startsAt,
          endsAt: alert.endsAt ? new Date(alert.endsAt) : null,
        },
        select: { id: true },
      });
      created.push(row.id);
    }

    this.log.log(
      `Ingest groupKey=${payload.groupKey} created=${created.length} matched=${matched.length}`,
    );
    return { created, matched };
  }

  /**
   * Match an incoming alert to a registered Connection. Strategy:
   *   1. label `model_name` exact match against Connection.model
   *   2. label `instance` host:port match against Connection.baseUrl
   *
   * Returns the first match; multi-match resolution is V2 (would need an
   * explicit selector field on Connection).
   */
  private async inferConnection(alert: AlertmanagerAlert): Promise<{ id: string } | null> {
    const modelName = alert.labels.model_name;
    if (modelName) {
      const hit = await this.prisma.connection.findFirst({
        where: { model: modelName },
        select: { id: true },
      });
      if (hit) return hit;
    }
    const instance = alert.labels.instance;
    if (instance) {
      // instance is typically host:port; baseUrl may carry scheme + path.
      // Substring match is good enough for v1 demo.
      const hit = await this.prisma.connection.findFirst({
        where: { baseUrl: { contains: instance.split(":")[0] } },
        select: { id: true },
      });
      if (hit) return hit;
    }
    return null;
  }

  async listForUser(userId: string, query: ListAlertsQuery) {
    const where: Prisma.AlertEventWhereInput = {
      // Scope: alerts where the connection belongs to this user, OR alerts
      // with no inferred connection (we show those globally so they're not
      // lost).
      OR: [{ connection: { userId } }, { connectionId: null }],
    };
    if (query.connectionId) where.connectionId = query.connectionId;
    if (query.status) where.status = query.status;
    if (query.severity) where.severity = query.severity;

    const rows = await this.prisma.alertEvent.findMany({
      where,
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      take: query.limit,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        explanation: {
          select: {
            narrative: true,
            recommendations: true,
            aiSeverity: true,
            generatedAt: true,
          },
        },
      },
    });
    return rows;
  }

  async getForUser(userId: string, id: string) {
    const row = await this.prisma.alertEvent.findFirst({
      where: {
        id,
        OR: [{ connection: { userId } }, { connectionId: null }],
      },
      include: { explanation: true, connection: { select: { id: true, name: true } } },
    });
    return row;
  }
}
