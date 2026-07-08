import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerTool } from "@modeldoctor/contracts";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { isBlockedHost } from "../../common/net/ssrf-guard.js";
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

  constructor(@Optional() @Inject(MCP_CLIENT_FACTORY) clientFactory?: McpClientFactory) {
    this.clientFactory = clientFactory ?? createDefaultClientHandle;
  }

  async discoverTools(server: DecryptedMcpServer): Promise<McpServerTool[]> {
    this.assertServerUrlAllowed(server);
    const { client, transport } = this.clientFactory(server, this.buildHeaders(server));
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      return tools.map((tool) => this.normalizeTool(tool));
    } finally {
      await this.closeQuietly(client);
    }
  }

  async callTool(
    server: DecryptedMcpServer,
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    this.assertServerUrlAllowed(server);
    const { client, transport } = this.clientFactory(server, this.buildHeaders(server));
    try {
      await client.connect(transport);
      const result = await client.callTool({ name, arguments: args });
      return this.normalizeContent(result);
    } finally {
      await this.closeQuietly(client);
    }
  }

  /**
   * `client.close()` in a bare `finally` would replace any in-flight error
   * from the `try` block with its own if it also throws (or silently
   * swallow a successful result if `close()` throws after the `try`
   * resolved but before `return` copies its value out — `finally` runs
   * either way and a throw there always wins). Swallowing this secondary
   * error keeps the original success/failure of `connect`/`listTools`/
   * `callTool` as the one thing callers observe; a close() failure just
   * means the underlying transport didn't tear down cleanly, which isn't
   * actionable for the caller anyway.
   */
  private async closeQuietly(client: McpSdkClient): Promise<void> {
    try {
      await client.close();
    } catch {
      // Intentionally ignored — see doc comment above.
    }
  }

  /**
   * SSRF guard (mirrors the `http_get` built-in tool — see
   * `apps/api/src/common/net/ssrf-guard.ts`). `server.url` is a
   * user-supplied value (created/edited via the MCP-servers CRUD, then
   * driven by both the `discover` endpoint and the agent loop's tool_call
   * path), so it MUST be validated before this service ever constructs a
   * transport or reaches the client factory — a bare `new URL(...)` +
   * `StreamableHTTPClientTransport` with no host check would let a caller
   * point the connection at localhost, RFC1918 ranges, or the cloud
   * metadata endpoint. Runs before `this.clientFactory(...)` (not just
   * before `connect()`) so neither the factory nor any transport
   * construction happens for a blocked/invalid URL.
   */
  private assertServerUrlAllowed(server: DecryptedMcpServer): void {
    let parsed: URL;
    try {
      parsed = new URL(server.url);
    } catch {
      throw new Error(`MCP server url "${server.url}" is not a valid URL`);
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        `MCP server url "${server.url}" uses unsupported scheme "${parsed.protocol}" (only http/https allowed)`,
      );
    }

    if (isBlockedHost(parsed.hostname)) {
      throw new Error(
        `MCP server host "${parsed.hostname}" is blocked (loopback/private/link-local/metadata addresses are not allowed)`,
      );
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

  /**
   * All-text content joins cleanly. Mixed content (e.g. a text summary
   * alongside an image part) still has useful text worth surfacing to the
   * model, so it's joined too — with a trailing note naming how many
   * non-text parts were omitted — rather than discarding it in favor of the
   * full JSON dump. Only when there is NO text at all (all-non-text, or an
   * empty/absent `content` array) does this fall back to `JSON.stringify`.
   */
  private normalizeContent(result: unknown): string {
    const content = (result as { content?: unknown[] } | undefined)?.content;
    if (!Array.isArray(content) || content.length === 0) {
      return JSON.stringify(result);
    }
    const textParts = content.filter(isTextContentPart);
    if (textParts.length === 0) {
      return JSON.stringify(result);
    }
    const joined = textParts.map((part) => part.text).join("\n");
    if (textParts.length === content.length) {
      return joined;
    }
    const omitted = content.length - textParts.length;
    return `${joined}\n[${omitted} non-text content part${omitted === 1 ? "" : "s"} omitted]`;
  }
}
