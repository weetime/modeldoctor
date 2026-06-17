import {
  type ConnectionPublic,
  type ConnectionRevealKeyResponse,
  type ConnectionStatusFilter,
  connectionStatusFilterSchema,
  type ConnectionWithSecret,
  type CreateConnection,
  createConnectionSchema,
  type DiscoverConnectionRequest,
  type DiscoverConnectionResponse,
  discoverConnectionRequestSchema,
  type ListConnectionsResponse,
  type UpdateConnection,
  updateConnectionSchema,
} from "@modeldoctor/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { ConnectionService } from "./connection.service.js";
import { DiscoveryService } from "./discovery/discovery.service.js";

@ApiTags("connections")
@ApiBearerAuth()
@Controller("connections")
@UseGuards(JwtAuthGuard)
export class ConnectionController {
  constructor(
    private readonly service: ConnectionService,
    private readonly discoveryService: DiscoveryService,
  ) {}

  @ApiOperation({ summary: "List connections (model endpoints + gateways) owned by the user" })
  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query("status", new ZodValidationPipe(connectionStatusFilterSchema.optional()))
    status: ConnectionStatusFilter | undefined,
  ): Promise<ListConnectionsResponse> {
    return this.service.list(user.sub, status ?? "enabled");
  }

  @ApiOperation({ summary: "Create a new connection (the response carries the api key once)" })
  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createConnectionSchema)) body: CreateConnection,
  ): Promise<ConnectionWithSecret> {
    return this.service.create(user.sub, body);
  }

  @ApiOperation({ summary: "Get a connection by ID (key is omitted from the response)" })
  @Get(":id")
  detail(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<ConnectionPublic> {
    return this.service.findOwnedPublic(user.sub, id);
  }

  @ApiOperation({ summary: "Reveal the decrypted api key for the connection (rate-limited)" })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get(":id/reveal-key")
  revealKey(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
  ): Promise<ConnectionRevealKeyResponse> {
    return this.service.revealApiKey(user.sub, id);
  }

  @ApiOperation({ summary: "Probe an endpoint and infer its capabilities (kind, model list)" })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("discover")
  discover(
    @Body(new ZodValidationPipe(discoverConnectionRequestSchema)) body: DiscoverConnectionRequest,
  ): Promise<DiscoverConnectionResponse> {
    return this.discoveryService.discover(body);
  }

  @ApiOperation({ summary: "Patch a connection (re-encrypts the key when supplied)" })
  @Patch(":id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateConnectionSchema)) body: UpdateConnection,
  ): Promise<ConnectionWithSecret | ConnectionPublic> {
    return this.service.update(user.sub, id, body);
  }

  @ApiOperation({ summary: "Delete a connection (cascades to its benchmarks and subscribers)" })
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    await this.service.delete(user.sub, id);
  }
}
