import type { McpServerTool } from "@modeldoctor/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { parseHeaderLines } from "../../integrations/openai-client/url.js";
import type { DecryptedMcpServer } from "../mcp-server/mcp-server.service.js";

/**
 * Minimal shape of the SDK `Client` this service depends on — enough to
 * connect, discover, invoke, and tear down. Kept narrow (rather than the
 * full SDK `Client` type) so the spec can stub it without instantiating
 * real protocol machinery.
 */
export interface McpSdkClient {
  connect(transport: unknown): Promise<void>;
  listTools(): Promise<{ tools: unknown[] }>;
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
}

export interface McpClientHandle {
  client: McpSdkClient;
  transport: unknown;
}

/**
 * Builds a fresh `{ client, transport }` pair for one discover/call
 * round-trip. Injectable so specs can substitute a fake pair without a real
 * network connection — see `McpClientService`'s constructor.
 */
export type McpClientFactory = (
  server: DecryptedMcpServer,
  headers: Record<string, string>,
) => McpClientHandle;

/** DI token for overriding the real client factory (tests only — production always defaults). */
export const MCP_CLIENT_FACTORY = Symbol("MCP_CLIENT_FACTORY");

const CLIENT_NAME = "modeldoctor-agent";
const CLIENT_VERSION = "1.0.0";

function createDefaultClientHandle(
  server: DecryptedMcpServer,
  headers: Record<string, string>,
): McpClientHandle {
  const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers },
  });
  return { client, transport };
}

interface TextContentPart {
  type: "text";
  text: string;
}

function isTextContentPart(part: unknown): part is TextContentPart {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as { type?: unknown }).type === "text" &&
    typeof (part as { text?: unknown }).text === "string"
  );
}

/**
 * Discovers + invokes tools on external MCP servers over Streamable HTTP.
 * Short-lived connection per call: connect, do the one thing, close in a
 * `finally` — no shared session state between calls, matching how the
 * (later) agent loop will call this from Task 11.
 */
@Injectable()
export class McpClientService {
  private readonly clientFactory: McpClientFactory;

  constructor(
    @Optional() @Inject(MCP_CLIENT_FACTORY) clientFactory?: McpClientFactory,
  ) {
    this.clientFactory = clientFactory ?? createDefaultClientHandle;
  }

  async discoverTools(server: DecryptedMcpServer): Promise<McpServerTool[]> {
    const { client, transport } = this.clientFactory(server, this.buildHeaders(server));
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      return tools.map((tool) => this.normalizeTool(tool));
    } finally {
      await client.close();
    }
  }

  async callTool(
    server: DecryptedMcpServer,
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const { client, transport } = this.clientFactory(server, this.buildHeaders(server));
    try {
      await client.connect(transport);
      const result = await client.callTool({ name, arguments: args });
      return this.normalizeContent(result);
    } finally {
      await client.close();
    }
  }

  private buildHeaders(server: DecryptedMcpServer): Record<string, string> {
    const headers = parseHeaderLines(server.headers);
    if (server.authToken) {
      headers.Authorization = `Bearer ${server.authToken}`;
    }
    return headers;
  }

  private normalizeTool(tool: unknown): McpServerTool {
    const t = tool as {
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
      annotations?: Record<string, unknown>;
    };
    return {
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema ?? {},
      annotations: t.annotations,
    };
  }

  private normalizeContent(result: unknown): string {
    const content = (result as { content?: unknown[] } | undefined)?.content;
    if (Array.isArray(content) && content.length > 0 && content.every(isTextContentPart)) {
      return (content as TextContentPart[]).map((part) => part.text).join("\n");
    }
    return JSON.stringify(result);
  }
}
