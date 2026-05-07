// apps/api/src/modules/llm-judge/llm-judge.service.ts
import type { LlmJudgeProviderPublic, UpsertLlmJudgeProvider } from "@modeldoctor/contracts";
import { Injectable, NotFoundException } from "@nestjs/common";
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

  async getPublic(userId: string): Promise<LlmJudgeProviderPublic | null> {
    const row = await this.prisma.llmJudgeProvider.findUnique({ where: { userId } });
    if (!row) return null;
    return {
      id: row.id, baseUrl: row.baseUrl, model: row.model, enabled: row.enabled,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getDecrypted(userId: string): Promise<DecryptedLlmJudgeProvider | null> {
    const row = await this.prisma.llmJudgeProvider.findUnique({ where: { userId } });
    if (!row) return null;
    return {
      id: row.id, baseUrl: row.baseUrl, apiKey: decrypt(row.apiKeyCipher, this.key),
      model: row.model, enabled: row.enabled,
    };
  }

  async upsert(userId: string, input: UpsertLlmJudgeProvider): Promise<LlmJudgeProviderPublic> {
    const apiKeyCipher = encrypt(input.apiKey, this.key);
    const row = await this.prisma.llmJudgeProvider.upsert({
      where: { userId },
      update: { baseUrl: input.baseUrl, apiKeyCipher, model: input.model, enabled: input.enabled },
      create: { userId, baseUrl: input.baseUrl, apiKeyCipher, model: input.model, enabled: input.enabled },
    });
    return {
      id: row.id, baseUrl: row.baseUrl, model: row.model, enabled: row.enabled,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  }

  async delete(userId: string): Promise<void> {
    const r = await this.prisma.llmJudgeProvider.deleteMany({ where: { userId } });
    if (r.count === 0) throw new NotFoundException("No provider configured");
  }
}
