import type { PublicUser } from "@modeldoctor/contracts";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { PrismaService } from "../../database/prisma.service.js";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(email: string, password: string, roles: string[] = ["user"]): Promise<PublicUser> {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: { email, passwordHash, roles },
    });
    return this.toPublic(user);
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException("User not found");
    return u;
  }

  async countAll(): Promise<number> {
    return this.prisma.user.count();
  }

  async verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
    return argon2.verify(passwordHash, plain);
  }

  toPublic(u: {
    id: string;
    email: string;
    roles: string[];
    displayName: string | null;
    avatarUrl: string | null;
    createdAt: Date;
  }): PublicUser {
    return {
      id: u.id,
      email: u.email,
      roles: u.roles,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      createdAt: u.createdAt.toISOString(),
    };
  }

  async updateProfile(
    id: string,
    patch: { displayName?: string | null; avatarUrl?: string | null },
  ): Promise<PublicUser> {
    const data: { displayName?: string | null; avatarUrl?: string | null } = {};
    if (Object.hasOwn(patch, "displayName")) data.displayName = patch.displayName ?? null;
    if (Object.hasOwn(patch, "avatarUrl")) {
      // Treat empty string as "clear".
      data.avatarUrl = patch.avatarUrl ? patch.avatarUrl : null;
    }
    const u = await this.prisma.user.update({ where: { id }, data });
    return this.toPublic(u);
  }

  async changePassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
    const u = await this.findById(id);
    const ok = await argon2.verify(u.passwordHash, currentPassword);
    if (!ok) throw new UnauthorizedException("Current password is incorrect");
    if (newPassword === currentPassword) {
      throw new BadRequestException("New password must differ from the current one");
    }
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    const now = new Date();
    // Update the hash AND revoke every live refresh-token family atomically.
    // Any session that authenticated with the OLD password is now denied at
    // the next /refresh (its row's revoked_at is set).
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { passwordHash } }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
  }
}
