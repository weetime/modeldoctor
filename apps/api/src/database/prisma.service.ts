import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import type { Env } from "../config/env.schema.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private connected = false;

  constructor(private readonly config: ConfigService<Env, true>) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const url = this.config.get("DATABASE_URL", { infer: true });
    if (!url) {
      this.logger.warn("DATABASE_URL is not set — skipping Prisma connect (test mode)");
      return;
    }
    await this.$connect();
    this.connected = true;
    this.logger.log("Prisma connected");
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.connected) return;
    await this.$disconnect();
    this.logger.log("Prisma disconnected");
  }
}
