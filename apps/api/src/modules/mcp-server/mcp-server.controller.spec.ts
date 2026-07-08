import type { McpServerPublic, McpServerTool } from "@modeldoctor/contracts";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { McpClientService } from "../mcp-client/mcp-client.service.js";
import { McpServerController } from "./mcp-server.controller.js";
import type { DecryptedMcpServer } from "./mcp-server.service.js";
import { McpServerService } from "./mcp-server.service.js";

const USER: JwtPayload = { sub: "u_1", email: "alice@example.com", roles: [] };

const DECRYPTED_FIXTURE: DecryptedMcpServer = {
  id: "mcp_1",
  name: "higress-gw",
  url: "https://higress.local/mcp",
  headers: "",
  authToken: "secret",
};

const TOOLS_FIXTURE: McpServerTool[] = [
  { name: "search", description: "Search docs", inputSchema: { type: "object", properties: {} } },
];

const PUBLIC_FIXTURE: McpServerPublic = {
  id: "mcp_1",
  userId: "u_1",
  name: "higress-gw",
  transport: "http",
  url: "https://higress.local/mcp",
  headers: "",
  toolsCache: TOOLS_FIXTURE,
  toolsCachedAt: "2026-07-08T00:00:00.000Z",
  enabled: true,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-08T00:00:00.000Z",
};

function makeMockService() {
  return {
    list: vi.fn(),
    create: vi.fn(),
    findOwnedPublic: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getOwnedDecrypted: vi.fn(),
    cacheTools: vi.fn(),
  };
}

function makeMockMcpClient() {
  return {
    discoverTools: vi.fn(),
    callTool: vi.fn(),
  };
}

describe("McpServerController", () => {
  let controller: McpServerController;
  let svc: ReturnType<typeof makeMockService>;
  let mcpClient: ReturnType<typeof makeMockMcpClient>;

  beforeEach(async () => {
    svc = makeMockService();
    mcpClient = makeMockMcpClient();

    const moduleRef = await Test.createTestingModule({
      controllers: [McpServerController],
      providers: [
        { provide: McpServerService, useValue: svc },
        { provide: McpClientService, useValue: mcpClient },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(McpServerController);
  });

  // -------------------------------------------------------------------------
  // POST /mcp-servers/:id/discover
  // -------------------------------------------------------------------------
  describe("discover", () => {
    it("decrypts the owned server, discovers its tools live, caches them, and returns the updated public shape", async () => {
      svc.getOwnedDecrypted.mockResolvedValue(DECRYPTED_FIXTURE);
      mcpClient.discoverTools.mockResolvedValue(TOOLS_FIXTURE);
      svc.cacheTools.mockResolvedValue(PUBLIC_FIXTURE);

      const result = await controller.discover(USER, "mcp_1");

      expect(svc.getOwnedDecrypted).toHaveBeenCalledWith("u_1", "mcp_1");
      expect(mcpClient.discoverTools).toHaveBeenCalledWith(DECRYPTED_FIXTURE);
      expect(svc.cacheTools).toHaveBeenCalledWith("u_1", "mcp_1", TOOLS_FIXTURE);
      expect(result).toBe(PUBLIC_FIXTURE);
    });

    it("propagates a getOwnedDecrypted failure without calling discoverTools/cacheTools", async () => {
      svc.getOwnedDecrypted.mockRejectedValue(new Error("not found"));

      await expect(controller.discover(USER, "mcp_x")).rejects.toThrow("not found");
      expect(mcpClient.discoverTools).not.toHaveBeenCalled();
      expect(svc.cacheTools).not.toHaveBeenCalled();
    });
  });
});
