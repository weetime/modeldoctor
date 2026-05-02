import { Module } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import { BaselineController } from "./baseline.controller.js";
import { BaselineService } from "./baseline.service.js";

@Module({
  controllers: [BaselineController],
  providers: [PrismaService, BaselineService],
  exports: [BaselineService],
})
export class BaselineModule {}
