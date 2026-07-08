import type { DecryptedMcpServer } from "../mcp-server/mcp-server.service.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

    it("connects before listing tools", async () => {
      fakeClient.listTools.mockResolvedValue({ tools: [] });

      await service.discoverTools(makeServer());

      expect(fakeClient.connect).toHaveBeenCalledWith({ __fakeTransport: true });
      expect(fakeClient.close).toHaveBeenCalledTimes(1);
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
  });
});
