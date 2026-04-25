import type { PublicUser } from "@modeldoctor/contracts";
import { Injectable, NotFoundException } from "@nestjs/common";
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

  toPublic(u: { id: string; email: string; roles: string[]; createdAt: Date }): PublicUser {
    return {
      id: u.id,
      email: u.email,
      roles: u.roles,
      createdAt: u.createdAt.toISOString(),
    };
  }
}
