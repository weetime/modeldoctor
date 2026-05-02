import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";
import { ConnectionModule } from "../connection/connection.module.js";
import { RunCallbackController } from "./callbacks/run-callback.controller.js";
import { createRunDriver } from "./drivers/run-driver.factory.js";
import { RUN_DRIVER } from "./drivers/run-driver.token.js";
import { RunController } from "./run.controller.js";
import { RunRepository } from "./run.repository.js";
import { RunService } from "./run.service.js";
import { SseHub } from "./sse/sse-hub.service.js";

@Module({
  imports: [ConfigModule, ConnectionModule],
  controllers: [RunController, RunCallbackController],
  providers: [
    PrismaService,
    RunRepository,
    RunService,
    SseHub,
    {
      provide: RUN_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => createRunDriver(config),
    },
  ],
  exports: [RunRepository, RunService, SseHub],
})
export class RunModule {}
