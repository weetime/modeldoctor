import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PlatformSourcesService } from "../sources/platform-sources.service.js";
import { SourceSyncService } from "../sync/source-sync.service.js";
import { AutomationRunnerService } from "./automation-runner.service.js";

@Injectable()
export class PlatformSourceCron {
  private readonly log = new Logger(PlatformSourceCron.name);

  constructor(
    private readonly runner: AutomationRunnerService,
    private readonly sources: PlatformSourcesService,
    private readonly sync: SourceSyncService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async tick(): Promise<void> {
    try {
      await this.runner.tick();
    } catch (e) {
      this.log.error("automation tick failed", e as Error);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async schedules(): Promise<void> {
    try {
      await this.runner.scanSchedules();
    } catch (e) {
      this.log.error("schedule scan failed", e as Error);
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcileAll(): Promise<void> {
    for (const id of await this.sources.listEnabledIds()) {
      await this.sync
        .reconcile(id)
        .catch((e) => this.log.warn(`reconcile ${id}: ${(e as Error).message}`));
    }
  }
}
