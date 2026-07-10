import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DecryptedMcpServer } from "../mcp-server/mcp-server.service.js";
import { McpClientService } from "./mcp-client.service.js";

function makeServer(overrides: Partial<DecryptedMcpServer> = {}): DecryptedMcpServer {
  return {
    id: "mcp_1",
    name: "higress-gw",
    url: "https://higress.local/mcp",
    headers: "X-Team: platform\nX-Env: staging",
    authToken: "secret-token",
    ...overrides,
  };
}

function makeFakeClient() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn(),
    callTool: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("McpClientService", () => {
  let fakeClient: ReturnType<typeof makeFakeClient>;
  let factorySpy: ReturnType<typeof vi.fn>;
  let service: McpClientService;

  beforeEach(() => {
    fakeClient = makeFakeClient();
    factorySpy = vi.fn().mockReturnValue({
      client: fakeClient,
      transport: { __fakeTransport: true },
    });
    service = new McpClientService(factorySpy);
  });

  describe("discoverTools", () => {
    it("normalizes listTools() into McpServerTool[], defaulting missing inputSchema to {}", async () => {
      fakeClient.listTools.mockResolvedValue({
        tools: [
          {
            name: "get_weather",
            description: "Fetches weather",
            inputSchema: { type: "object", properties: { city: { type: "string" } } },
            annotations: { readOnlyHint: true },
          },
          {
            name: "no_schema_tool",
            // inputSchema intentionally omitted
          },
        ],
      });

      const tools = await service.discoverTools(makeServer());

      expect(tools).toEqual([
        {
          name: "get_weather",
          description: "Fetches weather",
          inputSchema: { type: "object", properties: { city: { type: "string" } } },
          annotations: { readOnlyHint: true },
        },
        {
          name: "no_schema_tool",
          description: undefined,
          inputSchema: {},
          annotations: undefined,
        },
      ]);
    });

    it("passes parsed custom headers + Authorization bearer token into the client factory", async () => {
      fakeClient.listTools.mockResolvedValue({ tools: [] });

      await service.discoverTools(makeServer());

      expect(factorySpy).toHaveBeenCalledTimes(1);
      const [serverArg, headersArg] = factorySpy.mock.calls[0];
      expect(serverArg.url).toBe("https://higress.local/mcp");
      expect(headersArg).toEqual({
        "X-Team": "platform",
        "X-Env": "staging",
        Authorization: "Bearer secret-token",
      });
    });

    it("omits Authorization header when authToken is empty", async () => {
      fakeClient.listTools.mockResolvedValue({ tools: [] });

      await service.discoverTools(makeServer({ authToken: "" }));

      const [, headersArg] = factorySpy.mock.calls[0];
      expect(headersArg).toEqual({ "X-Team": "platform", "X-Env": "staging" });
    });

    it("closes the client even when listTools() throws", async () => {
      fakeClient.listTools.mockRejectedValue(new Error("boom"));

      await expect(service.discoverTools(makeServer())).rejects.toThrow("boom");

      expect(fakeClient.close).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["non-array", "oops"],
    ])("returns [] when a misbehaving server returns %s tools (no TypeError)", async (_label, tools) => {
      fakeClient.listTools.mockResolvedValue({ tools });
      await expect(service.discoverTools(makeServer())).resolves.toEqual([]);
    });

    it("connects before listing tools", async () => {
      fakeClient.listTools.mockResolvedValue({ tools: [] });

      await service.discoverTools(makeServer());

      expect(fakeClient.connect).toHaveBeenCalledWith({ __fakeTransport: true });
      expect(fakeClient.close).toHaveBeenCalledTimes(1);
    });

    it("surfaces the original listTools() error even when close() also throws", async () => {
      fakeClient.listTools.mockRejectedValue(new Error("original failure"));
      fakeClient.close.mockRejectedValue(new Error("close blew up"));

      await expect(service.discoverTools(makeServer())).rejects.toThrow("original failure");
      expect(fakeClient.close).toHaveBeenCalledTimes(1);
    });
  });

  describe("SSRF guard", () => {
    // Always blocked — even for admin-registered MCP servers. Loopback,
    // 0.0.0.0, link-local/cloud-metadata, and non-http(s) schemes are never a
    // legitimate MCP target.
    it.each([
      ["http://localhost/mcp", "loopback hostname"],
      ["http://127.0.0.1/mcp", "loopback IPv4"],
      ["http://0.0.0.0/mcp", "unspecified address"],
      ["http://169.254.169.254/mcp", "cloud metadata address"],
      ["http://[::ffff:169.254.169.254]/mcp", "IPv4-mapped metadata address"],
      ["file:///etc/passwd", "non-http(s) scheme"],
      ["not a url", "malformed url"],
    ])("discoverTools rejects %s (%s) without invoking the client factory", async (url) => {
      await expect(service.discoverTools(makeServer({ url }))).rejects.toThrow();
      expect(factorySpy).not.toHaveBeenCalled();
      expect(fakeClient.connect).not.toHaveBeenCalled();
    });

    it.each([
      ["http://localhost/mcp", "loopback hostname"],
      ["http://169.254.169.254/mcp", "cloud metadata address"],
      ["file:///etc/passwd", "non-http(s) scheme"],
    ])("callTool rejects %s (%s) without invoking the client factory", async (url) => {
      await expect(service.callTool(makeServer({ url }), "some_tool", {})).rejects.toThrow();
      expect(factorySpy).not.toHaveBeenCalled();
      expect(fakeClient.connect).not.toHaveBeenCalled();
    });

    // Private/cluster ranges ARE allowed — MCP servers are deliberately
    // registered by the admin against self-hosted (typically private-IP) infra.
    it.each([
      ["http://10.100.121.67:30888/mcp-servers/camp/mcp", "private 10.0.0.0/8 cluster address"],
      ["http://192.168.1.1/mcp", "private 192.168.0.0/16 address"],
      ["http://172.16.0.9/mcp", "private 172.16.0.0/12 address"],
      ["http://100.64.0.5/mcp", "CGNAT 100.64.0.0/10 address"],
    ])("discoverTools allows %s (%s) through to the client factory", async (url) => {
      fakeClient.listTools.mockResolvedValue({ tools: [] });
      await expect(service.discoverTools(makeServer({ url }))).resolves.toEqual([]);
      expect(factorySpy).toHaveBeenCalledTimes(1);
      expect(fakeClient.connect).toHaveBeenCalledTimes(1);
    });

    it("allows a normal https URL through to the client factory", async () => {
      fakeClient.listTools.mockResolvedValue({ tools: [] });
      await expect(service.discoverTools(makeServer())).resolves.toEqual([]);
      expect(factorySpy).toHaveBeenCalledTimes(1);
      expect(fakeClient.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe("callTool", () => {
    it("joins multi-part text content into a single string", async () => {
      fakeClient.callTool.mockResolvedValue({
        content: [
          { type: "text", text: "part one" },
          { type: "text", text: "part two" },
        ],
      });

      const result = await service.callTool(makeServer(), "some_tool", { foo: "bar" });

      expect(result).toBe("part one\npart two");
      expect(fakeClient.callTool).toHaveBeenCalledWith({
        name: "some_tool",
        arguments: { foo: "bar" },
      });
    });

    it("JSON.stringifies the whole result when content is non-text", async () => {
      const nonTextResult = {
        content: [{ type: "image", data: "base64...", mimeType: "image/png" }],
      };
      fakeClient.callTool.mockResolvedValue(nonTextResult);

      const result = await service.callTool(makeServer(), "some_tool", {});

      expect(result).toBe(JSON.stringify(nonTextResult));
    });

    it("JSON.stringifies the whole result when content is empty", async () => {
      const emptyResult = { content: [] };
      fakeClient.callTool.mockResolvedValue(emptyResult);

      const result = await service.callTool(makeServer(), "some_tool", {});

      expect(result).toBe(JSON.stringify(emptyResult));
    });

    it("closes the client even when callTool() throws", async () => {
      fakeClient.callTool.mockRejectedValue(new Error("kaboom"));

      await expect(service.callTool(makeServer(), "some_tool", {})).rejects.toThrow("kaboom");

      expect(fakeClient.close).toHaveBeenCalledTimes(1);
    });

    it("surfaces the original callTool() error even when close() also throws", async () => {
      fakeClient.callTool.mockRejectedValue(new Error("original failure"));
      fakeClient.close.mockRejectedValue(new Error("close blew up"));

      await expect(service.callTool(makeServer(), "some_tool", {})).rejects.toThrow(
        "original failure",
      );
      expect(fakeClient.close).toHaveBeenCalledTimes(1);
    });

    it("joins text parts and appends a note for non-text parts in mixed content", async () => {
      fakeClient.callTool.mockResolvedValue({
        content: [
          { type: "text", text: "here is the summary" },
          { type: "image", data: "base64...", mimeType: "image/png" },
        ],
      });

      const result = await service.callTool(makeServer(), "some_tool", {});

      expect(result).toBe("here is the summary\n[1 non-text content part omitted]");
    });
  });
});
