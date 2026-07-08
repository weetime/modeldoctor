import { Module } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import { SkillController } from "./skill.controller.js";
import { SkillService } from "./skill.service.js";

@Module({
  controllers: [SkillController],
  providers: [PrismaService, SkillService],
  exports: [SkillService],
})
export class SkillModule {}
