import type {
  ConnectionPublic,
  ConnectionRevealKeyResponse,
  ConnectionStatusFilter,
  ConnectionWithSecret,
  CreateConnection,
  ListConnectionsResponse,
  ModalityCategory,
  ServerKind,
  UpdateConnection,
} from "@modeldoctor/contracts";
import { ErrorCodes } from "@modeldoctor/contracts";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  Connection as PrismaConnection,
  PrometheusDatasource as PrismaPrometheusDatasource,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { decodeKey, decrypt, encrypt } from "../../common/crypto/aes-gcm.js";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";

/**
 * Joined connection row carrying the relations that toContractPublic /
 * toContractWithSecret need. All findUnique / findMany queries that feed those
 * mappers MUST use the matching `include:` so the join data is populated —
 * use the `CONNECTION_INCLUDES` const below to keep them in lockstep.
 */
type ConnectionRow = PrismaConnection & {
  evaluationProfile: { id: string; slug: string; name: string; nameKey: string | null } | null;
  prometheusDatasource: PrismaPrometheusDatasource | null;
};

/**
 * Canonical `include:` clause for every connection query that feeds a
 * `toContractPublic` / `toContractWithSecret` call. Centralized so the local
 * `ConnectionRow` payload type and the actual Prisma query stay in lockstep.
 */
const CONNECTION_INCLUDES = {
  evaluationProfile: true,
  prometheusDatasource: true,
} as const satisfies Prisma.ConnectionInclude;

export interface DecryptedConnection {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  customHeaders: string;
  queryParams: string;
  category: ModalityCategory | null;
  tokenizerHfId: string | null;
  /**
   * Bound Prometheus datasource (admin-managed entity from #199), with the
   * bearer token DECRYPTED at api side. Mirrors the `apiKey` plaintext shape
   * so adapters can forward to runners via `secretEnv` (never argv).
   * Null when no datasource is bound; bearerToken null when the datasource
   * is anonymous (no bearer configured).
   */
  prometheusDatasource: {
    id: string;
    baseUrl: string;
    bearerToken: string | null;
  } | null;
  prometheusDatasourceId: string | null;
  serverKind: ServerKind | null;
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
    const prometheusDatasourceId = await this.resolvePrometheusDatasourceId(
      input.prometheusDatasourceId,
    );
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
        prometheusDatasourceId,
        serverKind: input.serverKind ?? null,
        tokenizerHfId: input.tokenizerHfId ?? null,
        ...(input.evaluationProfileId !== undefined
          ? { evaluationProfileId: input.evaluationProfileId ?? null }
          : {}),
      },
      include: CONNECTION_INCLUDES,
    });
    return this.toContractWithSecret(row, input.apiKey);
  }

  async list(
    userId: string,
    status: ConnectionStatusFilter = "enabled",
  ): Promise<ListConnectionsResponse> {
    const where: Prisma.ConnectionWhereInput = { userId };
    if (status === "enabled") where.enabled = true;
    else if (status === "disabled") where.enabled = false;
    // "all" → no enabled clause.
    const rows = await this.prisma.connection.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: CONNECTION_INCLUDES,
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
    // updateConnectionSchema is `.partial()`; defend against PATCHes that
    // clear required fields by re-asserting the model-endpoint contract
    // when those fields are explicitly present.
    if (input.model !== undefined && input.model.trim().length === 0) {
      throw new BadRequestException("model must be non-empty");
    }
    if (input.category === null) {
      throw new BadRequestException("category must be non-null");
    }
    if (input.apiKey !== undefined && input.apiKey.length === 0) {
      throw new BadRequestException("apiKey must be non-empty");
    }
    const data: Prisma.ConnectionUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.baseUrl !== undefined) data.baseUrl = input.baseUrl;
    if (input.model !== undefined) data.model = input.model;
    if (input.customHeaders !== undefined) data.customHeaders = input.customHeaders;
    if (input.queryParams !== undefined) data.queryParams = input.queryParams;
    if (input.category !== undefined) data.category = input.category;
    if (input.tags !== undefined) data.tags = input.tags;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.prometheusDatasourceId !== undefined) {
      // PATCH semantics: only resolve when the client explicitly sent the
      // field (null or string). Skip when undefined — leave existing binding
      // untouched.
      data.prometheusDatasourceId = await this.resolvePrometheusDatasourceId(
        input.prometheusDatasourceId,
      );
    }
    if (input.serverKind !== undefined) data.serverKind = input.serverKind;
    if (input.tokenizerHfId !== undefined) data.tokenizerHfId = input.tokenizerHfId;
    if (input.evaluationProfileId !== undefined)
      data.evaluationProfileId = input.evaluationProfileId;
    if (input.apiKey !== undefined) {
      data.apiKeyCipher = encrypt(input.apiKey, this.key);
    }

    const row = await this.prisma.connection.update({
      where: { id },
      data,
      include: CONNECTION_INCLUDES,
    });

    if (input.apiKey !== undefined) {
      return this.toContractWithSecret(row, input.apiKey);
    }
    return this.toContractPublic(row);
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.findOwnedRow(userId, id);
    try {
      await this.prisma.connection.delete({ where: { id } });
    } catch (e) {
      // P2003 = a Restrict FK still references this connection. The only
      // Restrict references are EvaluationRun.endpointA / endpointB: a
      // quality-gate run was executed against this endpoint, and its A/B
      // comparison would lose meaning if the endpoint vanished. Surface a
      // readable 409 instead of letting Prisma's error bubble up as a 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        throw new ConflictException({
          code: ErrorCodes.CONFLICT,
          message:
            "This connection is referenced by one or more evaluation runs. Delete those runs first.",
        });
      }
      throw e;
    }
  }

  /**
   * Owner-only — exposes the decrypted apiKey for UI affordances that need
   * the plaintext (currently: benchmark detail page Request details panel).
   * Throws Forbidden / NotFound through `findOwnedRow` for unauthorized or
   * missing ids.
   */
  async revealApiKey(userId: string, id: string): Promise<ConnectionRevealKeyResponse> {
    const row = await this.findOwnedRow(userId, id);
    return { apiKey: this.decryptApiKey(row.apiKeyCipher) };
  }

  /**
   * Defensive apiKey decryption. The post-#220 contract requires non-empty
   * apiKey on create / update, but rows persisted in the brief window between
   * #218 (alertmanager retired) and #220 (kind field dropped) — when kind=
   * gateway still allowed an empty apiKey — could carry an empty cipher.
   * Returning "" for those rows preserves the pre-#220 read-path behavior
   * rather than throwing inside `decrypt` (which requires non-empty input).
   */
  private decryptApiKey(cipher: string): string {
    if (!cipher) return "";
    return decrypt(cipher, this.key);
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
      apiKey: this.decryptApiKey(row.apiKeyCipher),
      model: row.model,
      customHeaders: row.customHeaders,
      queryParams: row.queryParams,
      category: row.category as ModalityCategory | null,
      tokenizerHfId: row.tokenizerHfId,
      // Decrypt the datasource bearer once here so adapters / downstream
      // consumers get plaintext (same shape as `apiKey` above). Returning
      // ciphertext would force every consumer to import the decrypt helper
      // and the encryption key, defeating the boundary.
      // Defensive: if a row mid-migration has a bearerCipher that decrypts
      // with a rotated key, we surface `null` rather than throwing — the
      // upstream PrometheusFetcherService already logs that failure mode.
      prometheusDatasource: row.prometheusDatasource
        ? {
            id: row.prometheusDatasource.id,
            baseUrl: row.prometheusDatasource.baseUrl,
            bearerToken: this.tryDecryptBearer(row.prometheusDatasource.bearerCipher),
          }
        : null,
      prometheusDatasourceId: row.prometheusDatasourceId,
      serverKind: row.serverKind as ServerKind | null,
    };
  }

  /**
   * Defensive decryption of a Prometheus datasource bearer cipher. Returns
   * null when the cipher is empty (anonymous datasource) OR when decryption
   * fails (env key rotated, corrupted cipher, etc.) — same graceful-
   * degradation contract PrometheusFetcherService uses. Logging the
   * specific failure mode lives upstream in that service to avoid double-
   * logging from every connection read.
   */
  private tryDecryptBearer(cipher: string | null): string | null {
    if (!cipher) return null;
    try {
      return decrypt(cipher, this.key);
    } catch {
      return null;
    }
  }

  private async findOwnedRow(userId: string, id: string): Promise<ConnectionRow> {
    const row = await this.prisma.connection.findUnique({
      where: { id },
      include: CONNECTION_INCLUDES,
    });
    if (!row) throw new NotFoundException(`Connection ${id} not found`);
    if (row.userId !== userId) throw new ForbiddenException();
    return row;
  }

  /**
   * Resolves the prometheusDatasourceId to persist for a connection write,
   * implementing the three-state contract:
   *
   * - `undefined`  → fill with the current default datasource (null if no
   *                  default exists).
   * - `null`       → explicit unbind; persisted as null.
   * - `string`     → validated against the datasource table; throws
   *                  BadRequestException(`PROMETHEUS_DATASOURCE_NOT_FOUND`) when
   *                  unknown.
   */
  private async resolvePrometheusDatasourceId(
    fromClient: string | null | undefined,
  ): Promise<string | null> {
    if (fromClient === null) return null;
    if (typeof fromClient === "string") {
      const exists = await this.prisma.prometheusDatasource.findUnique({
        where: { id: fromClient },
        select: { id: true },
      });
      if (!exists) {
        throw new BadRequestException({
          message: `PrometheusDatasource ${fromClient} not found`,
          code: ErrorCodes.PROMETHEUS_DATASOURCE_NOT_FOUND,
        });
      }
      return fromClient;
    }
    // Undefined → auto-fill with current default datasource (if any).
    const def = await this.prisma.prometheusDatasource.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    return def?.id ?? null;
  }

  private toContractPublic(row: ConnectionRow): ConnectionPublic {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      baseUrl: row.baseUrl,
      apiKeyPreview: this.makePreview(this.decryptApiKey(row.apiKeyCipher)),
      model: row.model,
      customHeaders: row.customHeaders,
      queryParams: row.queryParams,
      category: row.category as ModalityCategory | null,
      tags: row.tags,
      enabled: row.enabled,
      prometheusDatasourceId: row.prometheusDatasourceId,
      prometheusDatasource: row.prometheusDatasource
        ? {
            id: row.prometheusDatasource.id,
            name: row.prometheusDatasource.name,
            baseUrl: row.prometheusDatasource.baseUrl,
          }
        : null,
      serverKind: row.serverKind as ConnectionPublic["serverKind"],
      tokenizerHfId: row.tokenizerHfId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      evaluationProfileId: row.evaluationProfileId,
      evaluationProfile: row.evaluationProfile
        ? {
            id: row.evaluationProfile.id,
            slug: row.evaluationProfile.slug,
            name: row.evaluationProfile.name,
            nameKey: row.evaluationProfile.nameKey,
          }
        : null,
    };
  }

  private toContractWithSecret(row: ConnectionRow, plaintext: string): ConnectionWithSecret {
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
