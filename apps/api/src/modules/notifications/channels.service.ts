import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ChannelType } from "@prisma/client";
import { decodeKey, decrypt, encrypt } from "../../common/crypto/aes-gcm.js";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";

export interface CreateChannelInput {
  type: ChannelType;
  name: string;
  url: string;
}

export interface UpdateChannelInput {
  name?: string;
  url?: string;
}

export interface ChannelRow {
  id: string;
  type: ChannelType;
  name: string;
  urlMasked: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ChannelsService {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    const k = config.get("CONNECTION_API_KEY_ENCRYPTION_KEY", { infer: true });
    if (!k) throw new Error("CONNECTION_API_KEY_ENCRYPTION_KEY is required");
    this.key = decodeKey(k);
  }

  async list(userId: string): Promise<ChannelRow[]> {
    const rows = await this.prisma.notificationChannel.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toRow(r));
  }

  async create(userId: string, input: CreateChannelInput): Promise<ChannelRow> {
    const cipher = encrypt(input.url, this.key);
    const row = await this.prisma.notificationChannel.create({
      data: {
        userId,
        type: input.type,
        name: input.name,
        config: { url: cipher },
      },
    });
    return this.toRow(row);
  }

  async update(userId: string, id: string, input: UpdateChannelInput): Promise<ChannelRow> {
    const existing = await this.prisma.notificationChannel.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException(`Channel ${id} not found`);
    const config = input.url
      ? { url: encrypt(input.url, this.key) }
      : (existing.config as { url: string });
    const row = await this.prisma.notificationChannel.update({
      where: { id },
      data: { name: input.name ?? existing.name, config },
    });
    return this.toRow(row);
  }

  async delete(userId: string, id: string): Promise<void> {
    const existing = await this.prisma.notificationChannel.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException(`Channel ${id} not found`);
    await this.prisma.notificationChannel.delete({ where: { id } });
  }

  /** Load + decrypt url. Internal use (dispatcher, test path). */
  async resolveForDispatch(channelId: string): Promise<{ type: ChannelType; url: string } | null> {
    const row = await this.prisma.notificationChannel.findUnique({ where: { id: channelId } });
    if (!row) return null;
    const cipher = (row.config as { url: string }).url;
    return { type: row.type, url: decrypt(cipher, this.key) };
  }

  maskUrl(plain: string): string {
    try {
      const u = new URL(plain);
      return `${u.protocol}//${u.host}/***`;
    } catch {
      return "***";
    }
  }

  private toRow(r: {
    id: string;
    type: ChannelType;
    name: string;
    config: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): ChannelRow {
    const cipher = (r.config as { url: string }).url;
    let urlMasked: string;
    try {
      urlMasked = this.maskUrl(decrypt(cipher, this.key));
    } catch {
      urlMasked = "***";
    }
    return {
      id: r.id,
      type: r.type,
      name: r.name,
      urlMasked,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
