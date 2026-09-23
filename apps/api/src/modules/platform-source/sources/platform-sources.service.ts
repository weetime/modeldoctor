import type {
  CreatePlatformSource,
  PlatformSource,
  TestPlatformSourceResponse,
  UpdatePlatformSource,
} from "@modeldoctor/contracts";
import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PlatformSource as PlatformSourceRow } from "@prisma/client";
import { decodeKey, decrypt, encrypt } from "../../../common/crypto/aes-gcm.js";
import type { Env } from "../../../config/env.schema.js";
import { PrismaService } from "../../../database/prisma.service.js";
import { GpustackClientFactory } from "../gpustack/gpustack-client.js";

type ChangeListener = (sourceId: string, kind: "upsert" | "delete") => void;
type RowWithCount = PlatformSourceRow & { _count: { models: number } };

const WITH_COUNT = { _count: { select: { models: true } } } as const;

function toPublic(r: RowWithCount): PlatformSource {
  return {
    id: r.id,
    kind: "gpustack",
    name: r.name,
    baseUrl: r.baseUrl,
    clusterId: r.clusterId,
    enabled: r.enabled,
    lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
    lastSyncError: r.lastSyncError,
    modelCount: r._count.models,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

@Injectable()
export class PlatformSourcesService {
  private readonly key: Buffer;
  private readonly listeners: ChangeListener[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: GpustackClientFactory,
    config: ConfigService<Env, true>,
  ) {
    const k = config.get("CONNECTION_API_KEY_ENCRYPTION_KEY", { infer: true });
    if (!k) throw new Error("CONNECTION_API_KEY_ENCRYPTION_KEY is required");
    this.key = decodeKey(k);
  }

  onChange(listener: ChangeListener): void {
    this.listeners.push(listener);
  }

  private emit(sourceId: string, kind: "upsert" | "delete"): void {
    for (const l of this.listeners) l(sourceId, kind);
  }

  async list(userId: string): Promise<PlatformSource[]> {
    const rows = await this.prisma.platformSource.findMany({
      where: { userId },
      include: WITH_COUNT,
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toPublic);
  }

  private async findOwned(userId: string, id: string): Promise<RowWithCount> {
    const r = await this.prisma.platformSource.findFirst({
      where: { id, userId },
      include: WITH_COUNT,
    });
    if (!r) throw new NotFoundException(`Platform source ${id} not found`);
    return r;
  }

  async get(userId: string, id: string): Promise<PlatformSource> {
    return toPublic(await this.findOwned(userId, id));
  }

  async create(userId: string, input: CreatePlatformSource): Promise<PlatformSource> {
    const r = await this.prisma.platformSource.create({
      data: {
        userId,
        kind: input.kind,
        name: input.name,
        baseUrl: input.baseUrl,
        apiKeyCipher: encrypt(input.apiKey, this.key),
        clusterId: input.clusterId ?? null,
      },
      include: WITH_COUNT,
    });
    this.emit(r.id, "upsert");
    return toPublic(r);
  }

  async update(userId: string, id: string, input: UpdatePlatformSource): Promise<PlatformSource> {
    await this.findOwned(userId, id);
    const r = await this.prisma.platformSource.update({
      where: { id },
      data: {
        name: input.name,
        baseUrl: input.baseUrl,
        apiKeyCipher: input.apiKey ? encrypt(input.apiKey, this.key) : undefined,
        clusterId: input.clusterId === undefined ? undefined : input.clusterId,
        enabled: input.enabled,
      },
      include: WITH_COUNT,
    });
    this.emit(id, "upsert");
    return toPublic(r);
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.findOwned(userId, id);
    await this.prisma.platformSource.delete({ where: { id } });
    this.emit(id, "delete");
  }

  async test(input: { baseUrl: string; apiKey: string }): Promise<TestPlatformSourceResponse> {
    try {
      const client = await this.clients.create(input.baseUrl.replace(/\/+$/, ""), input.apiKey);
      return { ok: true, modelCount: await client.countModels(), error: null };
    } catch (e) {
      return { ok: false, modelCount: null, error: (e as Error).message };
    }
  }

  async testSaved(userId: string, id: string): Promise<TestPlatformSourceResponse> {
    await this.findOwned(userId, id);
    const s = await this.getDecrypted(id);
    return this.test({ baseUrl: s.baseUrl, apiKey: s.apiKey });
  }

  async getDecrypted(id: string) {
    const r = await this.prisma.platformSource.findUnique({ where: { id } });
    if (!r) throw new NotFoundException(`Platform source ${id} not found`);
    return {
      id: r.id,
      userId: r.userId,
      baseUrl: r.baseUrl,
      apiKey: decrypt(r.apiKeyCipher, this.key),
      clusterId: r.clusterId,
      enabled: r.enabled,
    };
  }

  async listEnabledIds(): Promise<string[]> {
    const rows = await this.prisma.platformSource.findMany({
      where: { enabled: true },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
