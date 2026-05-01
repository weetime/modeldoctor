import { Module } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import { RunController } from "./run.controller.js";
import { RunRepository } from "./run.repository.js";
import { RunService } from "./run.service.js";

@Module({
  imports: [],
  controllers: [RunController],
  providers: [PrismaService, RunRepository, RunService],
  exports: [RunRepository, RunService],
})
export class RunModule {}
