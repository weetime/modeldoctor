import { createHash, randomBytes } from "node:crypto";
import type { PublicUser } from "@modeldoctor/contracts";
import { ConflictException, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";
import { UsersService } from "../users/users.service.js";
import type { JwtPayload } from "./jwt.strategy.js";

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

export type RefreshResult =
  | { kind: "rotated"; accessToken: string; refreshToken: string; user: PublicUser }
  | { kind: "graceReplayed"; accessToken: string; user: PublicUser };

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
      // Postgres serialization_failure (40001) — only happens under
      // Serializable isolation when two concurrent rotations of the same
      // family race past the FOR UPDATE lock. Retrying once gives the
      // loser a chance to observe the winner's revoked_at + replaced_by_id
      // and route through the grace-replay branch.
      if (this.isSerializationFailure(e)) {
        return await this.refreshOnce(presentedToken);
      }
      throw e;
    }
  }

  private isSerializationFailure(err: unknown): boolean {
    if (typeof err !== "object" || err === null) return false;
    const code = (err as { code?: string }).code;
    return code === "P2034" || code === "40001";
  }

  private async refreshOnce(presentedToken: string): Promise<RefreshResult> {
    const tokenHash = this.sha256hex(presentedToken);

    return this.prisma.$transaction(
      async (tx) => {
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
          // Inside grace window AND a successor exists → assume legitimate
          // racing tab / network retry. Mint a new access token; do NOT
          // rotate the cookie (the successor cookie is already in the
          // browser's cookie jar from the first rotation).
          const sinceRevoke = now.getTime() - presented.revoked_at.getTime();
          if (presented.replaced_by_id && sinceRevoke < AuthService.GRACE_WINDOW_MS) {
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
            return { kind: "graceReplayed", accessToken, user: publicUser };
          }

          // Outside grace window → genuine reuse. Revoke the entire family
          // (NOT every token of this user — concurrent sessions are
          // independent rotation chains).
          await tx.refreshToken.updateMany({
            where: { familyId: presented.family_id, revokedAt: null },
            data: { revokedAt: now },
          });
          this.logger.warn(
            { userId: presented.user_id, familyId: presented.family_id, rowId: presented.id },
            "Refresh token theft detected; family revoked",
          );
          throw new UnauthorizedException("Refresh token reused; session invalidated");
        }

        // HAPPY PATH — extend the chain. Issue a child rotation under the
        // same family; mark the parent revoked + replacedBy.
        const userRow = await this.users.findById(presented.user_id);
        const publicUser = this.users.toPublic(userRow);
        const issued = await this.issueRotation(
          publicUser,
          { id: presented.id, familyId: presented.family_id },
          tx as Pick<PrismaService, "refreshToken">,
        );

        // Find the child id we just created so we can wire replacedById.
        // issueRotation doesn't return the row, so we re-query — cheap
        // because token_hash is uniquely indexed.
        const childRow = await tx.refreshToken.findUnique({
          where: { tokenHash: this.sha256hex(issued.refreshToken) },
          select: { id: true },
        });
        if (!childRow) {
          throw new Error("rotation invariant: child row missing after issue");
        }

        await tx.refreshToken.update({
          where: { id: presented.id },
          data: { revokedAt: now, replacedById: childRow.id },
        });

        return {
          kind: "rotated",
          accessToken: issued.accessToken,
          refreshToken: issued.refreshToken,
          user: publicUser,
        };
      },
      { isolationLevel: "Serializable" },
    );
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

    return { accessToken, refreshToken, user };
  }

  private sha256hex(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
}
