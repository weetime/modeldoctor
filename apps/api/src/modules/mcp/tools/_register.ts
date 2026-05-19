import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";

/**
 * Thin wrapper around `McpServer.registerTool` that avoids the SDK's
 * deep zod generic inference (TS2589 "Type instantiation is excessively
 * deep"). The runtime call is identical — only TS typings are bypassed.
 *
 * Callers pass a typed `inputShape` AND an `input` type parameter; the
 * handler receives `input` typed by the caller. The shape itself is
 * forwarded to the SDK which converts it to JSON Schema for clients.
 */
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export function registerTool<TInput>(
  server: McpServer,
  config: {
    name: string;
    title: string;
    description: string;
    inputShape?: Record<string, z.ZodTypeAny>;
  },
  handler: (input: TInput) => Promise<ToolResult>,
): void {
  const meta: Record<string, unknown> = {
    title: config.title,
    description: config.description,
  };
  if (config.inputShape) {
    meta.inputSchema = config.inputShape;
  }
  // SDK's registerTool generics trigger TS2589 on complex zod chains
  // (default+coerce+optional). Type safety is restored at the handler
  // boundary via TInput.
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  (server.registerTool as any)(config.name, meta, handler as (...args: unknown[]) => unknown);
}
