import { Module } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import { GpustackClientFactory } from "./gpustack/gpustack-client.js";
import { PlatformSourcesController } from "./sources/platform-sources.controller.js";
import { PlatformSourcesService } from "./sources/platform-sources.service.js";

@Module({
  controllers: [PlatformSourcesController],
  providers: [PrismaService, GpustackClientFactory, PlatformSourcesService],
  exports: [PlatformSourcesService],
})
export class PlatformSourceModule {}
