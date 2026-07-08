import { Module } from "@nestjs/common";
import { McpClientService } from "./mcp-client.service.js";

/**
 * Standalone module for the MCP client (discover + call external MCP
 * tools). Deliberately has NO imports: `McpClientService` is pure — it takes
 * an already-decrypted server as a plain argument and never reaches into
 * `McpServerService` itself. Consumers (e.g. `McpServerModule`'s discover
 * route, `PlaygroundAgentModule`'s agent loop — Task 11) import both this
 * module and `McpServerModule` side by side; `McpServerModule` importing
 * this module back would create a cycle if this module also imported
 * `McpServerModule`, so it must not.
 */
@Module({
  providers: [McpClientService],
  exports: [McpClientService],
})
export class McpClientModule {}
