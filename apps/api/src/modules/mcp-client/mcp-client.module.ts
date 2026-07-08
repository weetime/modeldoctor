import { Module } from "@nestjs/common";
import { McpServerModule } from "../mcp-server/mcp-server.module.js";
import { McpClientService } from "./mcp-client.service.js";

/**
 * Standalone module for the MCP client (discover + call external MCP
 * tools). Imports McpServerModule so consumers in this module's graph can
 * resolve `McpServerService` (e.g. to fetch `getOwnedDecrypted` before
 * calling into `McpClientService`) — `McpClientService` itself stays pure
 * and takes an already-decrypted server as an argument, it does not reach
 * into McpServerService directly.
 *
 * Not wired into `AppModule` yet — the (later) agent loop module imports
 * this directly.
 */
@Module({
  imports: [McpServerModule],
  providers: [McpClientService],
  exports: [McpClientService],
})
export class McpClientModule {}
