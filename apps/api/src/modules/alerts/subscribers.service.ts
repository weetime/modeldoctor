import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import type { CreateSubscriberDto, Severity, UpdateSubscriberDto } from "./subscribers.dto.js";

// Severity ranking — higher means more severe. Used for "deliver if alert
// severity >= subscriber.minSeverity".
const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

export function severityMeetsFloor(alert: string, floor: string): boolean {
  const a = SEVERITY_RANK[alert as Severity] ?? -1;
  const f = SEVERITY_RANK[floor as Severity] ?? Number.POSITIVE_INFINITY;
  return a >= f;
}

@Injectable()
export class SubscribersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Assert the caller can manage subscribers for this connection. Today
   * that means: caller owns the connection. Future: connection-level
   * sharing / roles.
   */
  private async assertOwnsConnection(callerId: string, connectionId: string) {
    const conn = await this.prisma.connection.findUnique({
      where: { id: connectionId },
      select: { userId: true },
    });
    if (!conn) throw new NotFoundException("connection not found");
    if (conn.userId !== callerId) {
      throw new ForbiddenException("only the connection owner can manage subscribers");
    }
  }

  async list(callerId: string, connectionId: string) {
    await this.assertOwnsConnection(callerId, connectionId);
    const rows = await this.prisma.connectionSubscriber.findMany({
      where: { connectionId },
      orderBy: { createdAt: "asc" },
      include: {
        user: { select: { id: true, email: true, displayName: true } },
        channel: { select: { id: true, name: true, type: true } },
      },
    });
    return rows;
  }

  async create(callerId: string, connectionId: string, dto: CreateSubscriberDto) {
    await this.assertOwnsConnection(callerId, connectionId);
    const userId = dto.userId ?? callerId;

    // Validate channel belongs to the subscribed user (you can't deliver
    // to someone else's channel).
    const channel = await this.prisma.notificationChannel.findUnique({
      where: { id: dto.channelId },
      select: { userId: true },
    });
    if (!channel) throw new NotFoundException("channel not found");
    if (channel.userId !== userId) {
      throw new ForbiddenException("channel does not belong to the target user");
    }

    return this.prisma.connectionSubscriber.create({
      data: {
        connectionId,
        userId,
        channelId: dto.channelId,
        minSeverity: dto.minSeverity,
        enabled: dto.enabled,
      },
    });
  }

  async update(
    callerId: string,
    connectionId: string,
    subscriberId: string,
    dto: UpdateSubscriberDto,
  ) {
    await this.assertOwnsConnection(callerId, connectionId);
    const existing = await this.prisma.connectionSubscriber.findUnique({
      where: { id: subscriberId },
    });
    if (!existing || existing.connectionId !== connectionId) {
      throw new NotFoundException("subscriber not found");
    }
    return this.prisma.connectionSubscriber.update({
      where: { id: subscriberId },
      data: {
        ...(dto.minSeverity !== undefined ? { minSeverity: dto.minSeverity } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      },
    });
  }

  async delete(callerId: string, connectionId: string, subscriberId: string): Promise<void> {
    await this.assertOwnsConnection(callerId, connectionId);
    const existing = await this.prisma.connectionSubscriber.findUnique({
      where: { id: subscriberId },
      select: { connectionId: true },
    });
    if (!existing || existing.connectionId !== connectionId) {
      throw new NotFoundException("subscriber not found");
    }
    await this.prisma.connectionSubscriber.delete({ where: { id: subscriberId } });
  }

  /**
   * Find all subscribers for this connection whose minSeverity floor is
   * met by the alert. Used by the explainer to fan out notifications.
   */
  async findMatching(connectionId: string, alertSeverity: string) {
    const all = await this.prisma.connectionSubscriber.findMany({
      where: { connectionId, enabled: true },
      select: { id: true, userId: true, channelId: true, minSeverity: true },
    });
    return all.filter((s) => severityMeetsFloor(alertSeverity, s.minSeverity));
  }
}
