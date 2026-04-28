import { createHash, randomBytes } from "node:crypto";
import type { PublicUser } from "@modeldoctor/contracts";
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";
import { UsersService } from "../users/users.service.js";
import type { JwtPayload } from "./jwt.strategy.js";

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  user: PublicUser;
}

export type RefreshResult =
  | {
      kind: "rotated";
      accessToken: string;
      accessTokenExpiresAt: Date;
      refreshToken: string;
      user: PublicUser;
    }
  | { kind: "graceReplayed"; accessToken: string; accessTokenExpiresAt: Date; user: PublicUser };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // 30-second grace window per OAuth 2.0 Security BCP §4.13.2: a recently-
  // revoked refresh token whose successor still exists may still mint a fresh
  // access token (no cookie rotation). Eliminates StrictMode / multi-tab /
  // network-retry false-positive theft detections.
  private static readonly GRACE_WINDOW_MS = 30_000;

  constructor(
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async register(email: string, password: string): Promise<IssuedTokens> {
    const existing = await this.users.findByEmail(email);
    if (existing) throw new ConflictException("Email already registered");

    const disableFirstAdmin = this.config.get("DISABLE_FIRST_USER_ADMIN", { infer: true });
    const total = await this.users.countAll();
    const roles = !disableFirstAdmin && total === 0 ? ["admin"] : ["user"];

    const user = await this.users.create(email, password, roles);
    return this.issueNewSession(user);
  }

  async login(email: string, password: string): Promise<IssuedTokens> {
    const row = await this.users.findByEmail(email);
    if (!row) throw new UnauthorizedException("Invalid credentials");
    const ok = await this.users.verifyPassword(row.passwordHash, password);
    if (!ok) throw new UnauthorizedException("Invalid credentials");
    return this.issueNewSession(this.users.toPublic(row));
  }

  async refresh(presentedToken: string): Promise<RefreshResult> {
    try {
      return await this.refreshOnce(presentedToken);
    } catch (e) {
      if (this.isSerializationFailure(e)) {
        // Postgres serialization_failure (40001 / Prisma P2034). Happens under
        // Serializable isolation when two concurrent rotations of the same
        // family race past the FOR UPDATE lock. The retry observes the
        // winner's commit and routes through the grace-replay branch.
        this.logger.debug("refresh retried after serialization_failure");
        return await this.refreshOnce(presentedToken);
      }
      throw e;
    }
  }

  private isSerializationFailure(err: unknown): boolean {
    if (typeof err !== "object" || err === null) return false;
    const e = err as { code?: string; meta?: { code?: string } };
    // Direct match on Prisma's transaction-conflict code or the Postgres
    // SQLSTATE. Plus: under interactive $transaction(...) Prisma surfaces
    // serialization_failure as P2010 with the SQLSTATE in meta.code, which
    // is the actual shape we hit in concurrent rotations of the same cookie.
    return (
      e.code === "P2034" || e.code === "40001" || (e.code === "P2010" && e.meta?.code === "40001")
    );
  }

  private async refreshOnce(presentedToken: string): Promise<RefreshResult> {
    type TxnOutcome =
      | {
          kind: "rotated";
          accessToken: string;
          accessTokenExpiresAt: Date;
          refreshToken: string;
          user: PublicUser;
        }
      | { kind: "graceReplayed"; accessToken: string; accessTokenExpiresAt: Date; user: PublicUser }
      | { kind: "theft"; userId: string; familyId: string; rowId: string };

    const tokenHash = this.sha256hex(presentedToken);

    const outcome = await this.prisma.$transaction(
      async (tx): Promise<TxnOutcome> => {
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            user_id: string;
            family_id: string;
            parent_id: string | null;
            replaced_by_id: string | null;
            expires_at: Date;
            revoked_at: Date | null;
          }>
        >`SELECT id, user_id, family_id, parent_id, replaced_by_id, expires_at, revoked_at
            FROM "refresh_tokens"
            WHERE "token_hash" = ${tokenHash}
            FOR UPDATE`;

        const presented = rows[0];
        if (!presented) throw new UnauthorizedException("Invalid refresh token");

        const now = new Date();
        if (presented.expires_at < now) {
          throw new UnauthorizedException("Refresh token expired");
        }

        if (presented.revoked_at !== null) {
          const sinceRevoke = now.getTime() - presented.revoked_at.getTime();
          if (presented.replaced_by_id && sinceRevoke < AuthService.GRACE_WINDOW_MS) {
            // GRACE REPLAY — mint a fresh access token, do NOT touch any rows.
            const userRow = await this.users.findById(presented.user_id);
            const publicUser = this.users.toPublic(userRow);
            const payload: JwtPayload = {
              sub: publicUser.id,
              email: publicUser.email,
              roles: publicUser.roles,
            };
            const accessToken = await this.jwt.signAsync(payload, {
              secret: this.config.get("JWT_ACCESS_SECRET", { infer: true }) ?? "",
              expiresIn: this.config.get("JWT_ACCESS_EXPIRES_IN", { infer: true }),
            });
            const expiresInMs = this.parseExpiresInMs(
              this.config.get("JWT_ACCESS_EXPIRES_IN", { infer: true }) ?? "15m",
            );
            const accessTokenExpiresAt = new Date(Date.now() + expiresInMs);
            return { kind: "graceReplayed", accessToken, accessTokenExpiresAt, user: publicUser };
          }

          // THEFT — revoke the family inside the txn, then return a sentinel
          // so the caller can throw AFTER the txn commits. Throwing here
          // would roll the family-revoke back; that would leave siblings
          // alive and silently weaken the security guarantee.
          await tx.refreshToken.updateMany({
            where: { familyId: presented.family_id, revokedAt: null },
            data: { revokedAt: now },
          });
          return {
            kind: "theft",
            userId: presented.user_id,
            familyId: presented.family_id,
            rowId: presented.id,
          };
        }

        // HAPPY PATH — extend the chain.
        const userRow = await this.users.findById(presented.user_id);
        const publicUser = this.users.toPublic(userRow);
        const issued = await this.issueRotation(
          publicUser,
          { id: presented.id, familyId: presented.family_id },
          tx as Pick<PrismaService, "refreshToken">,
        );

        const childRow = await tx.refreshToken.findUnique({
          where: { tokenHash: this.sha256hex(issued.refreshToken) },
          select: { id: true },
        });
        if (!childRow) {
          this.logger.error(
            {
              userId: presented.user_id,
              familyId: presented.family_id,
              parentRowId: presented.id,
            },
            "rotation invariant: child row missing after issue",
          );
          throw new InternalServerErrorException(
            "rotation invariant: child row missing after issue",
          );
        }

        await tx.refreshToken.update({
          where: { id: presented.id },
          data: { revokedAt: now, replacedById: childRow.id },
        });

        return {
          kind: "rotated",
          accessToken: issued.accessToken,
          accessTokenExpiresAt: issued.accessTokenExpiresAt,
          refreshToken: issued.refreshToken,
          user: publicUser,
        };
      },
      { isolationLevel: "Serializable" },
    );

    if (outcome.kind === "theft") {
      this.logger.warn(
        { userId: outcome.userId, familyId: outcome.familyId, rowId: outcome.rowId },
        "Refresh token theft detected; family revoked",
      );
      throw new UnauthorizedException("Refresh token reused; session invalidated");
    }
    return outcome;
  }

  async logout(presentedToken: string): Promise<void> {
    const tokenHash = this.sha256hex(presentedToken);
    // updateMany is idempotent — no error when the token is unknown or already
    // revoked. This keeps logout safe to call with a stale cookie.
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async issueNewSession(user: PublicUser): Promise<IssuedTokens> {
    // Run the two-step chain-root insert (create with placeholder familyId,
    // then update familyId = self.id) inside a transaction so a crash between
    // the two writes can never leave an orphaned __pending__ row in the table.
    return this.prisma.$transaction(async (tx) =>
      this.issueRotation(user, null, tx as Pick<PrismaService, "refreshToken">),
    );
  }

  /**
   * Internal helper. Creates a new RefreshToken row + signs an access token.
   * If `parent` is null, this token starts a new family (familyId = self.id).
   * Otherwise, familyId is inherited from the parent and parentId is set.
   *
   * The optional `tx` argument lets Task A3's transactional refresh path
   * route the writes through its $transaction client. Defaults to the
   * shared PrismaService.
   *
   * Caller is responsible for marking parent.replacedById = newRow.id and
   * parent.revokedAt = now() inside the same transaction (see refresh()).
   */
  private async issueRotation(
    user: PublicUser,
    parent: { id: string; familyId: string } | null,
    tx: Pick<PrismaService, "refreshToken"> = this.prisma,
  ): Promise<IssuedTokens> {
    const payload: JwtPayload = { sub: user.id, email: user.email, roles: user.roles };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get("JWT_ACCESS_SECRET", { infer: true }) ?? "",
      expiresIn: this.config.get("JWT_ACCESS_EXPIRES_IN", { infer: true }),
    });
    const expiresInMs = this.parseExpiresInMs(
      this.config.get("JWT_ACCESS_EXPIRES_IN", { infer: true }) ?? "15m",
    );
    const accessTokenExpiresAt = new Date(Date.now() + expiresInMs);

    // Refresh token: 48 random bytes → 64-char base64url string. High entropy
    // means SHA-256 is sufficient for storage (see plan design note). Argon2
    // buys nothing here and would add ~100ms to every refresh.
    const refreshToken = randomBytes(48).toString("base64url");
    const refreshDays = this.config.get("JWT_REFRESH_EXPIRES_DAYS", { infer: true });
    const expiresAt = new Date(Date.now() + refreshDays * 86_400_000);

    if (parent === null) {
      // Root of a new family. Two-step: create with placeholder, then patch
      // familyId = self.id. Avoids needing a pre-generated cuid in app code.
      const created = await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: this.sha256hex(refreshToken),
          expiresAt,
          familyId: "__pending__",
          parentId: null,
        },
      });
      await tx.refreshToken.update({
        where: { id: created.id },
        data: { familyId: created.id },
      });
    } else {
      await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: this.sha256hex(refreshToken),
          expiresAt,
          familyId: parent.familyId,
          parentId: parent.id,
        },
      });
    }

    return { accessToken, accessTokenExpiresAt, refreshToken, user };
  }

  /**
   * Parse JWT_ACCESS_EXPIRES_IN (e.g. "15m", "1h", "7200s", or a bare integer
   * meaning seconds) to milliseconds. Mirrors @nestjs/jwt's expiresIn parsing
   * so the value we surface to clients matches the JWT exp claim itself.
   */
  private parseExpiresInMs(value: string): number {
    const match = /^(\d+)\s*(s|m|h|d)?$/.exec(value);
    if (!match) throw new Error(`Invalid JWT_ACCESS_EXPIRES_IN: ${value}`);
    const n = Number.parseInt(match[1] ?? "", 10);
    const unit = match[2] ?? "s";
    const ms = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 1_000;
    return n * ms;
  }

  private sha256hex(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
}
