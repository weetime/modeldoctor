import { Module } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import { ConnectionModule } from "../connection/connection.module.js";
import { GpustackClientFactory } from "./gpustack/gpustack-client.js";
import { PlatformSourcesController } from "./sources/platform-sources.controller.js";
import { PlatformSourcesService } from "./sources/platform-sources.service.js";
import { SourceSyncService } from "./sync/source-sync.service.js";
import { SourceWatcherService } from "./sync/source-watcher.service.js";

@Module({
  imports: [ConnectionModule],
  controllers: [PlatformSourcesController],
  providers: [
    PrismaService,
    GpustackClientFactory,
    PlatformSourcesService,
    SourceSyncService,
    SourceWatcherService,
  ],
  exports: [PlatformSourcesService, SourceSyncService],
})
export class PlatformSourceModule {}
