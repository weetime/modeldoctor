import type {
  CreateMcpServer,
  ListMcpServersResponse,
  McpServerPublic,
  McpServerTool,
  McpServerTransport,
  McpServerWithSecret,
  UpdateMcpServer,
} from "@modeldoctor/contracts";
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { McpServer as PrismaMcpServer } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { decodeKey, decrypt, encrypt } from "../../common/crypto/aes-gcm.js";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";

/**
 * Owner-only decrypted credential bundle. Used internally by the (later)
 * discovery / tools-call flow — never exposed via HTTP.
 */
export interface DecryptedMcpServer {
  id: string;
  name: string;
  url: string;
  headers: string;
  authToken: string;
}

@Injectable()
export class McpServerService {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    const k = config.get("CONNECTION_API_KEY_ENCRYPTION_KEY", { infer: true });
    if (!k) {
      throw new Error("CONNECTION_API_KEY_ENCRYPTION_KEY is required");
    }
    this.key = decodeKey(k);
  }

  async create(userId: string, input: CreateMcpServer): Promise<McpServerWithSecret> {
    const authTokenCipher = input.authToken ? encrypt(input.authToken, this.key) : null;
    const row = await this.prisma.mcpServer.create({
      data: {
        userId,
        name: input.name,
        description: input.description,
        transport: input.transport,
        url: input.url,
        authTokenCipher,
        headers: input.headers,
      },
    });
    return this.toContractWithSecret(row, input.authToken ?? "");
  }

  async list(userId: string): Promise<ListMcpServersResponse> {
    const rows = await this.prisma.mcpServer.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return { items: rows.map((r) => this.toContractPublic(r)) };
  }

  async findOwnedPublic(userId: string, id: string): Promise<McpServerPublic> {
    const row = await this.findOwnedRow(userId, id);
    return this.toContractPublic(row);
  }

  async update(
    userId: string,
    id: string,
    input: UpdateMcpServer,
  ): Promise<McpServerWithSecret | McpServerPublic> {
    await this.findOwnedRow(userId, id);
    const data: Prisma.McpServerUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.transport !== undefined) data.transport = input.transport;
    if (input.url !== undefined) data.url = input.url;
    if (input.headers !== undefined) data.headers = input.headers;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.authToken !== undefined) {
      data.authTokenCipher = input.authToken ? encrypt(input.authToken, this.key) : null;
    }

    const row = await this.prisma.mcpServer.update({ where: { id }, data });

    if (input.authToken !== undefined) {
      return this.toContractWithSecret(row, input.authToken);
    }
    return this.toContractPublic(row);
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.findOwnedRow(userId, id);
    await this.prisma.mcpServer.delete({ where: { id } });
  }

  /**
   * INTERNAL — not exposed via HTTP. Used by the (later) MCP discovery /
   * tools-call flow to obtain decrypted credentials for an upstream call.
   */
  async getOwnedDecrypted(userId: string, id: string): Promise<DecryptedMcpServer> {
    const row = await this.findOwnedRow(userId, id);
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      headers: row.headers,
      authToken: this.decryptAuthToken(row.authTokenCipher),
    };
  }

  /**
   * Persists a fresh tools/list result (and its fetch timestamp) for the
   * server. Ownership-checked like every other mutation. Called by the
   * (later) discovery route after a live MCP tools/list round-trip.
   */
  async cacheTools(userId: string, id: string, tools: McpServerTool[]): Promise<McpServerPublic> {
    await this.findOwnedRow(userId, id);
    const row = await this.prisma.mcpServer.update({
      where: { id },
      data: {
        toolsCache: tools as unknown as Prisma.InputJsonValue,
        toolsCachedAt: new Date(),
      },
    });
    return this.toContractPublic(row);
  }

  /**
   * Defensive authToken decryption, mirroring ConnectionService's
   * `decryptApiKey`. Returns "" when no cipher is set — not every MCP
   * server requires auth, so `authTokenCipher` is nullable.
   */
  private decryptAuthToken(cipher: string | null): string {
    if (!cipher) return "";
    return decrypt(cipher, this.key);
  }

  private async findOwnedRow(userId: string, id: string): Promise<PrismaMcpServer> {
    const row = await this.prisma.mcpServer.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`McpServer ${id} not found`);
    if (row.userId !== userId) throw new ForbiddenException();
    return row;
  }

  private toContractPublic(row: PrismaMcpServer): McpServerPublic {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      description: row.description ?? undefined,
      transport: row.transport as McpServerTransport,
      url: row.url,
      authTokenPreview: row.authTokenCipher
        ? this.makePreview(this.decryptAuthToken(row.authTokenCipher))
        : undefined,
      headers: row.headers,
      toolsCache: (row.toolsCache as McpServerTool[] | null) ?? null,
      toolsCachedAt: row.toolsCachedAt ? row.toolsCachedAt.toISOString() : null,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toContractWithSecret(row: PrismaMcpServer, plaintext: string): McpServerWithSecret {
    return {
      ...this.toContractPublic(row),
      authToken: plaintext,
      authTokenPreview: plaintext ? this.makePreview(plaintext) : undefined,
    };
  }

  private makePreview(authToken: string): string {
    if (authToken.length <= 7) return authToken;
    return `${authToken.slice(0, 3)}...${authToken.slice(-4)}`;
  }
}
