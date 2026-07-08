import { Module } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import { McpServerController } from "./mcp-server.controller.js";
import { McpServerService } from "./mcp-server.service.js";

@Module({
  controllers: [McpServerController],
  providers: [PrismaService, McpServerService],
  exports: [McpServerService],
})
export class McpServerModule {}
