// apps/api/src/modules/llm-judge/llm-judge.service.ts
import type {
  CreateLlmJudgeProvider,
  ListLlmJudgeProvidersResponse,
  LlmJudgeProviderPublic,
  UpdateLlmJudgeProvider,
} from "@modeldoctor/contracts";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { decodeKey, decrypt, encrypt } from "../../common/crypto/aes-gcm.js";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";

export interface DecryptedLlmJudgeProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  isDefault: boolean;
}

/** Caller identity for authorization. The controller flattens `JwtPayload`
 * into this shape so the service stays test-friendly. */
export interface LlmJudgeActor {
  sub: string;
  isAdmin: boolean;
}

function makePreview(plain: string): string {
  if (!plain) return "";
  // Never echo a short key verbatim — mask it to avoid exposing mock/custom keys.
  if (plain.length <= 7) return "...";
  return `${plain.slice(0, 3)}...${plain.slice(-4)}`;
}

type Row = Prisma.LlmJudgeProviderGetPayload<Record<string, never>>;

/**
 * Workspace-wide LLM-judge providers. Multiple may be registered; at most one
 * is the default. Invariant enforced here: a row with `isDefault === true`
 * always has `enabled === true` (you cannot make the default disabled, and
 * promoting to default also enables). Consumers call `getDecrypted()` with no
 * selector to use the default provider.
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

  async list(_actor: LlmJudgeActor): Promise<ListLlmJudgeProvidersResponse> {
    const rows = await this.prisma.llmJudgeProvider.findMany({
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    return { items: rows.map((r) => this.toPublic(r)) };
  }

  async getOne(_actor: LlmJudgeActor, id: string): Promise<LlmJudgeProviderPublic> {
    const row = await this.prisma.llmJudgeProvider.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`LlmJudgeProvider ${id} not found`);
    return this.toPublic(row);
  }

  async create(
    actor: LlmJudgeActor,
    input: CreateLlmJudgeProvider,
  ): Promise<LlmJudgeProviderPublic> {
    this.requireAdmin(actor);
    // Invariant: the default must stay enabled.
    if (input.isDefault && input.enabled === false) {
      throw new BadRequestException("the default provider must be enabled");
    }
    const enabled = input.isDefault ? true : input.enabled;
    const apiKeyCipher = encrypt(input.apiKey, this.key);

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (input.isDefault) {
          await tx.llmJudgeProvider.updateMany({
            where: { isDefault: true },
            data: { isDefault: false },
          });
        }
        return tx.llmJudgeProvider.create({
          data: {
            name: input.name,
            baseUrl: input.baseUrl,
            apiKeyCipher,
            model: input.model,
            enabled,
            isDefault: input.isDefault ?? false,
          },
        });
      });
      return this.toPublic(row);
    } catch (e) {
      this.translateUniqueErr(e);
      throw e;
    }
  }

  async update(
    actor: LlmJudgeActor,
    id: string,
    input: UpdateLlmJudgeProvider,
  ): Promise<LlmJudgeProviderPublic> {
    this.requireAdmin(actor);
    const existing = await this.prisma.llmJudgeProvider.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`LlmJudgeProvider ${id} not found`);

    const data: Prisma.LlmJudgeProviderUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.baseUrl !== undefined) data.baseUrl = input.baseUrl;
    if (input.model !== undefined) data.model = input.model;
    if (input.apiKey !== undefined) data.apiKeyCipher = encrypt(input.apiKey, this.key);

    // Resolve the post-update (isDefault, enabled) pair so we can enforce the
    // invariant before writing.
    const nextIsDefault = input.isDefault ?? existing.isDefault;
    const nextEnabled = input.enabled ?? existing.enabled;
    if (nextIsDefault && input.enabled === false) {
      // Explicit attempt to disable the (current or about-to-be) default.
      throw new BadRequestException(
        "cannot disable the default provider; promote another provider to default first",
      );
    }
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (nextIsDefault) data.enabled = true; // promoting to / staying default implies enabled

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (input.isDefault === true) {
          await tx.llmJudgeProvider.updateMany({
            where: { isDefault: true, NOT: { id } },
            data: { isDefault: false },
          });
          data.isDefault = true;
        } else if (input.isDefault === false) {
          // Demote: the workspace may sit with zero defaults (AI features off),
          // matching the Prometheus-datasource model.
          data.isDefault = false;
        }
        return tx.llmJudgeProvider.update({ where: { id }, data });
      });
      return this.toPublic(row);
    } catch (e) {
      this.translateUniqueErr(e);
      throw e;
    }
  }

  async setDefault(actor: LlmJudgeActor, id: string): Promise<LlmJudgeProviderPublic> {
    this.requireAdmin(actor);
    const existing = await this.prisma.llmJudgeProvider.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`LlmJudgeProvider ${id} not found`);

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.llmJudgeProvider.updateMany({
        where: { isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
      // Promoting to default also enables — the default must be usable.
      return tx.llmJudgeProvider.update({
        where: { id },
        data: { isDefault: true, enabled: true },
      });
    });
    return this.toPublic(row);
  }

  async remove(actor: LlmJudgeActor, id: string): Promise<void> {
    this.requireAdmin(actor);
    const existing = await this.prisma.llmJudgeProvider.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`LlmJudgeProvider ${id} not found`);
    await this.prisma.llmJudgeProvider.delete({ where: { id } });
  }

  /**
   * Resolve a provider's decrypted config for consumers. With no selector the
   * default provider is returned; pass `{ id }` to target a specific row.
   * Returns null when the requested provider (or the default) does not exist.
   */
  async getDecrypted(selector?: { id?: string }): Promise<DecryptedLlmJudgeProvider | null> {
    const row = selector?.id
      ? await this.prisma.llmJudgeProvider.findUnique({ where: { id: selector.id } })
      : await this.prisma.llmJudgeProvider.findFirst({ where: { isDefault: true } });
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      baseUrl: row.baseUrl,
      apiKey: decrypt(row.apiKeyCipher, this.key),
      model: row.model,
      enabled: row.enabled,
      isDefault: row.isDefault,
    };
  }

  private requireAdmin(actor: LlmJudgeActor) {
    if (!actor.isAdmin) throw new ForbiddenException("admin role required");
  }

  private toPublic(row: Row): LlmJudgeProviderPublic {
    return {
      id: row.id,
      name: row.name,
      baseUrl: row.baseUrl,
      model: row.model,
      enabled: row.enabled,
      isDefault: row.isDefault,
      apiKeyPreview: row.apiKeyCipher ? makePreview(decrypt(row.apiKeyCipher, this.key)) : "",
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private translateUniqueErr(e: unknown): void {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = (e.meta?.target as string[]) ?? [];
      if (target.includes("name")) {
        throw new ConflictException({
          message: "name already taken",
          code: "LLM_JUDGE_PROVIDER_NAME_TAKEN",
        });
      }
    }
  }
}
