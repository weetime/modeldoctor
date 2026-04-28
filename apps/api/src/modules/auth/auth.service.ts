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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

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

  async refresh(presentedToken: string): Promise<IssuedTokens> {
    const tokenHash = this.sha256hex(presentedToken);
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!row) throw new UnauthorizedException("Invalid refresh token");

    const now = new Date();
    if (row.expiresAt < now) throw new UnauthorizedException("Refresh token expired");

    if (row.revokedAt !== null) {
      // THEFT DETECTION: a revoked token was presented → revoke ALL of this
      // user's outstanding refresh tokens to invalidate any concurrent session.
      await this.prisma.refreshToken.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      this.logger.warn(
        { userId: row.userId, rowId: row.id },
        "Refresh token theft detected; all tokens revoked",
      );
      throw new UnauthorizedException("Refresh token reused; session invalidated");
    }

    // Happy path: rotate — revoke the old token and issue a new pair.
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: now },
    });
    const user = await this.users.findById(row.userId);
    return this.issueRotation(this.users.toPublic(user), null);
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
