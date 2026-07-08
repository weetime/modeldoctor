import { Module } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import { McpClientModule } from "../mcp-client/mcp-client.module.js";
import { McpServerController } from "./mcp-server.controller.js";
import { McpServerService } from "./mcp-server.service.js";

/**
 * Imports `McpClientModule` for the `POST :id/discover` route (Task 11),
 * which decrypts the server via `McpServerService` then does a live
 * `McpClientService.discoverTools` round-trip. No cycle: `McpClientModule`
 * does not import this module back (see its doc comment).
 */
@Module({
  imports: [McpClientModule],
  controllers: [McpServerController],
  providers: [PrismaService, McpServerService],
  exports: [McpServerService],
})
export class McpServerModule {}
