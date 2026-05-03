import type {
  ConnectionPublic,
  ConnectionWithSecret,
  CreateConnection,
  ListConnectionsResponse,
  ModalityCategory,
  UpdateConnection,
} from "@modeldoctor/contracts";
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma, Connection as PrismaConnection } from "@prisma/client";
import { decodeKey, decrypt, encrypt } from "../../common/crypto/aes-gcm.js";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";

export interface DecryptedConnection {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  customHeaders: string;
  queryParams: string;
  category: ModalityCategory;
  tokenizerHfId: string | null;
}

@Injectable()
export class ConnectionService {
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

  async create(userId: string, input: CreateConnection): Promise<ConnectionWithSecret> {
    const apiKeyCipher = encrypt(input.apiKey, this.key);
    const row = await this.prisma.connection.create({
      data: {
        userId,
        name: input.name,
        baseUrl: input.baseUrl,
        apiKeyCipher,
        model: input.model,
        customHeaders: input.customHeaders,
        queryParams: input.queryParams,
        category: input.category,
        tags: input.tags,
        prometheusUrl: input.prometheusUrl ?? null,
        serverKind: input.serverKind ?? null,
        tokenizerHfId: input.tokenizerHfId ?? null,
      },
    });
    return this.toContractWithSecret(row, input.apiKey);
  }

  async list(userId: string): Promise<ListConnectionsResponse> {
    const rows = await this.prisma.connection.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return {
      items: rows.map((r) => this.toContractPublic(r)),
    };
  }

  async findOwnedPublic(userId: string, id: string): Promise<ConnectionPublic> {
    const row = await this.findOwnedRow(userId, id);
    return this.toContractPublic(row);
  }

  async update(
    userId: string,
    id: string,
    input: UpdateConnection,
  ): Promise<ConnectionWithSecret | ConnectionPublic> {
    await this.findOwnedRow(userId, id);
    const data: Prisma.ConnectionUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.baseUrl !== undefined) data.baseUrl = input.baseUrl;
    if (input.model !== undefined) data.model = input.model;
    if (input.customHeaders !== undefined) data.customHeaders = input.customHeaders;
    if (input.queryParams !== undefined) data.queryParams = input.queryParams;
    if (input.category !== undefined) data.category = input.category;
    if (input.tags !== undefined) data.tags = input.tags;
    if (input.prometheusUrl !== undefined) data.prometheusUrl = input.prometheusUrl;
    if (input.serverKind !== undefined) data.serverKind = input.serverKind;
    if (input.tokenizerHfId !== undefined) data.tokenizerHfId = input.tokenizerHfId;
    if (input.apiKey !== undefined) data.apiKeyCipher = encrypt(input.apiKey, this.key);

    const row = await this.prisma.connection.update({ where: { id }, data });

    if (input.apiKey !== undefined) {
      return this.toContractWithSecret(row, input.apiKey);
    }
    return this.toContractPublic(row);
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.findOwnedRow(userId, id);
    await this.prisma.connection.delete({ where: { id } });
  }

  /**
   * INTERNAL — not exposed via HTTP. Used by playground/load-test/e2e/benchmark
   * services to obtain decrypted credentials for an upstream call.
   */
  async getOwnedDecrypted(userId: string, id: string): Promise<DecryptedConnection> {
    const row = await this.findOwnedRow(userId, id);
    return {
      id: row.id,
      name: row.name,
      baseUrl: row.baseUrl,
      apiKey: decrypt(row.apiKeyCipher, this.key),
      model: row.model,
      customHeaders: row.customHeaders,
      queryParams: row.queryParams,
      category: row.category as ModalityCategory,
      tokenizerHfId: row.tokenizerHfId,
    };
  }

  private async findOwnedRow(userId: string, id: string): Promise<PrismaConnection> {
    const row = await this.prisma.connection.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Connection ${id} not found`);
    if (row.userId !== userId) throw new ForbiddenException();
    return row;
  }

  private toContractPublic(row: PrismaConnection): ConnectionPublic {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      baseUrl: row.baseUrl,
      apiKeyPreview: this.makePreview(decrypt(row.apiKeyCipher, this.key)),
      model: row.model,
      customHeaders: row.customHeaders,
      queryParams: row.queryParams,
      category: row.category as ModalityCategory,
      tags: row.tags,
      prometheusUrl: row.prometheusUrl,
      serverKind: row.serverKind as ConnectionPublic["serverKind"],
      tokenizerHfId: row.tokenizerHfId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toContractWithSecret(row: PrismaConnection, plaintext: string): ConnectionWithSecret {
    return {
      ...this.toContractPublic(row),
      apiKey: plaintext,
      apiKeyPreview: this.makePreview(plaintext),
    };
  }

  private makePreview(apiKey: string): string {
    if (apiKey.length <= 7) return apiKey;
    return `${apiKey.slice(0, 3)}...${apiKey.slice(-4)}`;
  }
}
