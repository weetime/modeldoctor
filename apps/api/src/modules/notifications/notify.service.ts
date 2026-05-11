import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";
import type { EventType } from "./subscriptions.service.js";

export interface NotifyInput {
  eventType: EventType;
  userId: string;
  connectionId?: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class NotifyService {
  private readonly log = new Logger(NotifyService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fan out an event to matching subscriptions by inserting outbox rows.
   * The producer service calls this AFTER its state-change update commits.
   * If the producer crashes between commit and emit, no notification fires —
   * acceptable for V1 (a missed alert is preferable to a phantom one). The
   * cron dispatcher reads outbox rows independently.
   */
  async emit(input: NotifyInput): Promise<void> {
    const subs = await this.prisma.notificationSubscription.findMany({
      where: {
        eventType: input.eventType,
        channel: { userId: input.userId },
      },
    });
    const matched = subs.filter((s) => {
      const f = s.filter as { connectionId?: string } | null;
      if (!f?.connectionId) return true;
      return f.connectionId === input.connectionId;
    });
    if (matched.length === 0) {
      this.log.debug(`No subscribers for ${input.eventType} user=${input.userId}`);
      return;
    }
    await this.prisma.notificationDelivery.createMany({
      data: matched.map((s) => ({
        channelId: s.channelId,
        eventType: input.eventType,
        payload: input.payload as Prisma.InputJsonValue,
      })),
    });
    this.log.log(
      `Queued ${matched.length} deliveries for ${input.eventType} user=${input.userId}`,
    );
  }
}
