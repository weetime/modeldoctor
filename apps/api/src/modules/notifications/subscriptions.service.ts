import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";

export type EventType = "benchmark.completed" | "benchmark.failed" | "diagnostics.failed";

export interface CreateSubscriptionInput {
  channelId: string;
  eventType: EventType;
  connectionId?: string;
}

export interface SubscriptionRow {
  id: string;
  channelId: string;
  channelName: string;
  eventType: EventType;
  connectionId?: string;
  createdAt: Date;
}

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<SubscriptionRow[]> {
    const rows = await this.prisma.notificationSubscription.findMany({
      where: { channel: { userId } },
      orderBy: { createdAt: "desc" },
      include: { channel: { select: { name: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      channelId: r.channelId,
      channelName: r.channel.name,
      eventType: r.eventType as EventType,
      connectionId: (r.filter as { connectionId?: string } | null)?.connectionId,
      createdAt: r.createdAt,
    }));
  }

  async create(userId: string, input: CreateSubscriptionInput): Promise<SubscriptionRow> {
    const channel = await this.prisma.notificationChannel.findFirst({
      where: { id: input.channelId, userId },
    });
    if (!channel) throw new NotFoundException(`Channel ${input.channelId} not found`);
    const row = await this.prisma.notificationSubscription.create({
      data: {
        channelId: input.channelId,
        eventType: input.eventType,
        filter: input.connectionId ? { connectionId: input.connectionId } : undefined,
      },
    });
    return {
      id: row.id,
      channelId: row.channelId,
      channelName: channel.name,
      eventType: row.eventType as EventType,
      connectionId: input.connectionId,
      createdAt: row.createdAt,
    };
  }

  async delete(userId: string, id: string): Promise<void> {
    const existing = await this.prisma.notificationSubscription.findFirst({
      where: { id, channel: { userId } },
    });
    if (!existing) throw new NotFoundException(`Subscription ${id} not found`);
    await this.prisma.notificationSubscription.delete({ where: { id } });
  }
}
