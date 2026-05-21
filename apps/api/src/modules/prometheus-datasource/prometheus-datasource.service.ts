import type {
  CreatePrometheusDatasource,
  ListPrometheusDatasourcesResponse,
  PrometheusDatasourcePublic,
  PrometheusDatasourceWithSecret,
  UpdatePrometheusDatasource,
} from "@modeldoctor/contracts";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { decodeKey, decrypt, encrypt } from "../../common/crypto/aes-gcm.js";
import { PrismaService } from "../../database/prisma.service.js";

/** DI token used by `PrometheusDatasourceModule` to inject the base64-encoded
 * 32-byte AES-256-GCM key. Mirrors the env var consumed by ConnectionService
 * and LlmJudgeService (`CONNECTION_API_KEY_ENCRYPTION_KEY`) so all three
 * modules encrypt/decrypt under the same key. */
export const PROMETHEUS_DS_ENC_KEY = Symbol("PROMETHEUS_DS_ENC_KEY");

/** Caller identity used for authorization decisions. The controller flattens
 * `JwtPayload` into this shape so the service stays test-friendly without
 * a JwtPayload import in tests. */
export interface PrometheusDatasourceActor {
  sub: string;
  isAdmin: boolean;
}

function makePreview(plain: string): string {
  if (!plain) return "";
  if (plain.length <= 7) return plain;
  return `${plain.slice(0, 3)}...${plain.slice(-4)}`;
}

type Row = Prisma.PrometheusDatasourceGetPayload<{
  include: { _count: { select: { consumers: true } } };
}>;

@Injectable()
export class PrometheusDatasourceService {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROMETHEUS_DS_ENC_KEY) keyB64: string,
  ) {
    this.key = decodeKey(keyB64);
  }

  async list(_actor: PrometheusDatasourceActor): Promise<ListPrometheusDatasourcesResponse> {
    const rows = await this.prisma.prometheusDatasource.findMany({
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      include: { _count: { select: { consumers: true } } },
    });
    return { items: rows.map((r) => this.toPublic(r)) };
  }

  async getOne(_actor: PrometheusDatasourceActor, id: string): Promise<PrometheusDatasourcePublic> {
    const row = await this.prisma.prometheusDatasource.findUnique({
      where: { id },
      include: { _count: { select: { consumers: true } } },
    });
    if (!row) throw new NotFoundException(`PrometheusDatasource ${id} not found`);
    return this.toPublic(row);
  }

  async create(
    actor: PrometheusDatasourceActor,
    input: CreatePrometheusDatasource,
  ): Promise<PrometheusDatasourceWithSecret> {
    this.requireAdmin(actor);
    const bearerCipher = input.bearerToken ? encrypt(input.bearerToken, this.key) : "";

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (input.isDefault) {
          await tx.prometheusDatasource.updateMany({
            where: { isDefault: true },
            data: { isDefault: false },
          });
        }
        return tx.prometheusDatasource.create({
          data: {
            name: input.name,
            baseUrl: input.baseUrl,
            bearerCipher,
            customHeaders: input.customHeaders ?? "",
            isDefault: input.isDefault ?? false,
          },
          include: { _count: { select: { consumers: true } } },
        });
      });
      return this.toWithSecret(row, input.bearerToken ?? "");
    } catch (e) {
      this.translateUniqueErr(e);
      throw e;
    }
  }

  async update(
    actor: PrometheusDatasourceActor,
    id: string,
    input: UpdatePrometheusDatasource,
  ): Promise<PrometheusDatasourcePublic | PrometheusDatasourceWithSecret> {
    this.requireAdmin(actor);
    const existing = await this.prisma.prometheusDatasource.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`PrometheusDatasource ${id} not found`);

    const data: Prisma.PrometheusDatasourceUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.baseUrl !== undefined) data.baseUrl = input.baseUrl;
    if (input.customHeaders !== undefined) data.customHeaders = input.customHeaders;
    if (input.bearerToken !== undefined) {
      data.bearerCipher = input.bearerToken ? encrypt(input.bearerToken, this.key) : "";
    }

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (input.isDefault === true) {
          // Promote: clear any existing default first so the partial unique
          // index (only one row may be isDefault=true) stays satisfied.
          await tx.prometheusDatasource.updateMany({
            where: { isDefault: true, NOT: { id } },
            data: { isDefault: false },
          });
          data.isDefault = true;
        } else if (input.isDefault === false) {
          // Demote: explicit un-default. Leaving the workspace with no
          // default row is allowed — new connections will skip auto-bind
          // and store prometheusDatasourceId=null until an operator picks
          // another default via setDefault() or edits another row.
          data.isDefault = false;
        }
        return tx.prometheusDatasource.update({
          where: { id },
          data,
          include: { _count: { select: { consumers: true } } },
        });
      });
      if (input.bearerToken !== undefined) {
        return this.toWithSecret(row, input.bearerToken);
      }
      return this.toPublic(row);
    } catch (e) {
      this.translateUniqueErr(e);
      throw e;
    }
  }

  async setDefault(
    actor: PrometheusDatasourceActor,
    id: string,
  ): Promise<PrometheusDatasourcePublic> {
    this.requireAdmin(actor);
    const existing = await this.prisma.prometheusDatasource.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`PrometheusDatasource ${id} not found`);

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.prometheusDatasource.updateMany({
        where: { isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
      return tx.prometheusDatasource.update({
        where: { id },
        data: { isDefault: true },
        include: { _count: { select: { consumers: true } } },
      });
    });
    return this.toPublic(row);
  }

  async remove(
    actor: PrometheusDatasourceActor,
    id: string,
  ): Promise<{ consumersDetached: number }> {
    this.requireAdmin(actor);
    const existing = await this.prisma.prometheusDatasource.findUnique({
      where: { id },
      include: { _count: { select: { consumers: true } } },
    });
    if (!existing) throw new NotFoundException(`PrometheusDatasource ${id} not found`);
    const consumersDetached = existing._count.consumers;
    await this.prisma.prometheusDatasource.delete({ where: { id } });
    return { consumersDetached };
  }

  private requireAdmin(actor: PrometheusDatasourceActor) {
    if (!actor.isAdmin) throw new ForbiddenException("admin role required");
  }

  private toPublic(row: Row): PrometheusDatasourcePublic {
    return {
      id: row.id,
      name: row.name,
      baseUrl: row.baseUrl,
      bearerPreview: row.bearerCipher ? makePreview(decrypt(row.bearerCipher, this.key)) : "",
      customHeaders: row.customHeaders,
      isDefault: row.isDefault,
      consumersCount: row._count.consumers,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toWithSecret(row: Row, plain: string): PrometheusDatasourceWithSecret {
    return { ...this.toPublic(row), bearerToken: plain };
  }

  private translateUniqueErr(e: unknown): void {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = (e.meta?.target as string[]) ?? [];
      if (target.includes("name")) {
        throw new ConflictException({
          message: "name already taken",
          code: "PROMETHEUS_DATASOURCE_NAME_TAKEN",
        });
      }
      if (target.includes("base_url")) {
        throw new ConflictException({
          message: "baseUrl already taken",
          code: "PROMETHEUS_DATASOURCE_BASEURL_TAKEN",
        });
      }
    }
  }
}
