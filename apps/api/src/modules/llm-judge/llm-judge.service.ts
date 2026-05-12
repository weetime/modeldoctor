// apps/api/src/modules/llm-judge/llm-judge.service.ts
import type { LlmJudgeProviderPublic, UpsertLlmJudgeProvider } from "@modeldoctor/contracts";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { decodeKey, decrypt, encrypt } from "../../common/crypto/aes-gcm.js";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";

export interface DecryptedLlmJudgeProvider {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

/**
 * Global (singleton) LLM-judge provider configuration. The table allows multiple
 * rows but we only ever read the most-recently-updated one; writes upsert by
 * matching that row's id (or create when the table is empty).
 */
@Injectable()
export class LlmJudgeService {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    const k = config.get("CONNECTION_API_KEY_ENCRYPTION_KEY", { infer: true });
    if (!k) throw new Error("CONNECTION_API_KEY_ENCRYPTION_KEY is required");
    this.key = decodeKey(k);
  }

  private async findCurrent() {
    return this.prisma.llmJudgeProvider.findFirst({
      orderBy: { updatedAt: "desc" },
    });
  }

  async getPublic(): Promise<LlmJudgeProviderPublic | null> {
    const row = await this.findCurrent();
    if (!row) return null;
    return {
      id: row.id,
      baseUrl: row.baseUrl,
      model: row.model,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getDecrypted(): Promise<DecryptedLlmJudgeProvider | null> {
    const row = await this.findCurrent();
    if (!row) return null;
    return {
      id: row.id,
      baseUrl: row.baseUrl,
      apiKey: decrypt(row.apiKeyCipher, this.key),
      model: row.model,
      enabled: row.enabled,
    };
  }

  async upsert(input: UpsertLlmJudgeProvider): Promise<LlmJudgeProviderPublic> {
    const existing = await this.findCurrent();
    let apiKeyCipher: string;
    if (input.apiKey) {
      apiKeyCipher = encrypt(input.apiKey, this.key);
    } else if (existing) {
      apiKeyCipher = existing.apiKeyCipher;
    } else {
      throw new BadRequestException("apiKey is required to create the provider");
    }
    const row = existing
      ? await this.prisma.llmJudgeProvider.update({
          where: { id: existing.id },
          data: {
            baseUrl: input.baseUrl,
            apiKeyCipher,
            model: input.model,
            enabled: input.enabled,
          },
        })
      : await this.prisma.llmJudgeProvider.create({
          data: {
            baseUrl: input.baseUrl,
            apiKeyCipher,
            model: input.model,
            enabled: input.enabled,
          },
        });
    return {
      id: row.id,
      baseUrl: row.baseUrl,
      model: row.model,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async delete(): Promise<void> {
    const r = await this.prisma.llmJudgeProvider.deleteMany({});
    if (r.count === 0) throw new NotFoundException("No provider configured");
  }
}
