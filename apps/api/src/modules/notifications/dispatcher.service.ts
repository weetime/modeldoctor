import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../database/prisma.service.js";
import { dispatchToChannel } from "./adapters/index.js";
import { ChannelsService } from "./channels.service.js";

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 50;
// Seconds to wait after attempt N before scheduling the next retry. Attempt 3
// is terminal and has no entry (handled separately).
const BACKOFF_SECONDS: Record<number, number> = { 1: 30, 2: 300 };

@Injectable()
export class DispatcherService {
  private readonly log = new Logger(DispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async cron(): Promise<void> {
    try {
      await this.tick();
    } catch (e) {
      this.log.error("Dispatcher tick failed", e as Error);
    }
  }

  /** Public for tests; orchestrates one pass. */
  async tick(): Promise<void> {
    const now = new Date();
    const due = await this.prisma.notificationDelivery.findMany({
      where: {
        OR: [
          { status: "pending" },
          {
            status: "failed",
            attempts: { lt: MAX_ATTEMPTS },
            nextRetryAt: { lte: now },
          },
        ],
      },
      take: BATCH_SIZE,
    });
    if (due.length === 0) return;
    this.log.debug(`Dispatcher processing ${due.length} deliveries`);
    for (const row of due) {
      await this.processOne(row, now);
    }
  }

  private async processOne(
    row: {
      id: string;
      channelId: string;
      eventType: string;
      payload: unknown;
      attempts: number;
    },
    now: Date,
  ): Promise<void> {
    const channel = await this.channels.resolveForDispatch(row.channelId);
    if (!channel) {
      await this.prisma.notificationDelivery.update({
        where: { id: row.id },
        data: {
          status: "failed",
          lastError: "channel deleted",
          nextRetryAt: null,
          attempts: MAX_ATTEMPTS,
        },
      });
      return;
    }
    try {
      await dispatchToChannel(channel.type, channel.url, {
        eventType: row.eventType,
        payload: row.payload as Record<string, unknown>,
      });
      await this.prisma.notificationDelivery.update({
        where: { id: row.id },
        data: { status: "sent", sentAt: now, lastError: null, nextRetryAt: null },
      });
    } catch (e) {
      const attempts = row.attempts + 1;
      const isTerminal = attempts >= MAX_ATTEMPTS;
      const delay = BACKOFF_SECONDS[attempts];
      const nextRetryAt = isTerminal || !delay ? null : new Date(now.getTime() + delay * 1000);
      await this.prisma.notificationDelivery.update({
        where: { id: row.id },
        data: {
          status: "failed",
          attempts,
          lastError: ((e as Error).message ?? String(e)).slice(0, 2048),
          nextRetryAt,
        },
      });
    }
  }

  /** Used by `POST /channels/:id/test` to dispatch a single row immediately. */
  async dispatchById(id: string): Promise<void> {
    const row = await this.prisma.notificationDelivery.findUnique({ where: { id } });
    if (!row) throw new Error(`Delivery ${id} not found`);
    await this.processOne(row, new Date());
  }
}
