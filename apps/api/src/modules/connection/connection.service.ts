import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  Connection,
  CreateConnection,
  ListConnectionsResponse,
  UpdateConnection,
} from "@modeldoctor/contracts";
import type { Connection as PrismaConnection } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";

@Injectable()
export class ConnectionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, input: CreateConnection): Promise<Connection> {
    const row = await this.prisma.connection.create({
      data: {
        userId,
        name: input.name,
        baseUrl: input.baseUrl,
        apiType: input.apiType,
        prometheusUrl: input.prometheusUrl ?? null,
        serverKind: input.serverKind ?? null,
      },
    });
    return toContract(row);
  }

  async list(userId: string): Promise<ListConnectionsResponse> {
    const rows = await this.prisma.connection.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return { items: rows.map(toContract) };
  }

  async findOwned(userId: string, id: string): Promise<Connection> {
    const row = await this.prisma.connection.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Connection ${id} not found`);
    if (row.userId !== userId) throw new ForbiddenException();
    return toContract(row);
  }

  async update(userId: string, id: string, input: UpdateConnection): Promise<Connection> {
    await this.findOwned(userId, id);
    const row = await this.prisma.connection.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
        ...(input.apiType !== undefined && { apiType: input.apiType }),
        ...(input.prometheusUrl !== undefined && { prometheusUrl: input.prometheusUrl }),
        ...(input.serverKind !== undefined && { serverKind: input.serverKind }),
      },
    });
    return toContract(row);
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.findOwned(userId, id);
    await this.prisma.connection.delete({ where: { id } });
  }
}

function toContract(row: PrismaConnection): Connection {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    baseUrl: row.baseUrl,
    apiType: row.apiType as Connection["apiType"],
    prometheusUrl: row.prometheusUrl,
    serverKind: (row.serverKind ?? null) as Connection["serverKind"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
