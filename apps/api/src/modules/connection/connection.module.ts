import { Module } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import { ConnectionController } from "./connection.controller.js";
import { ConnectionService } from "./connection.service.js";

@Module({
  controllers: [ConnectionController],
  providers: [PrismaService, ConnectionService],
  exports: [ConnectionService],
})
export class ConnectionModule {}
