import {
  type ConnectionPublic,
  type ConnectionRevealKeyResponse,
  type ConnectionWithSecret,
  type CreateConnection,
  type DiscoverConnectionRequest,
  type DiscoverConnectionResponse,
  type ListConnectionsResponse,
  type UpdateConnection,
  type VerifyKindRequest,
  type VerifyKindResponse,
  createConnectionSchema,
  discoverConnectionRequestSchema,
  updateConnectionSchema,
  verifyKindRequestSchema,
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
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { ConnectionService } from "./connection.service.js";
import { DiscoveryService } from "./discovery/discovery.service.js";
import { verifyConnectionKind } from "./discovery/verify-kind.js";

@Controller("connections")
@UseGuards(JwtAuthGuard)
export class ConnectionController {
  constructor(
    private readonly service: ConnectionService,
    private readonly discoveryService: DiscoveryService,
  ) {}

  @Get()
  list(@CurrentUser() user: JwtPayload): Promise<ListConnectionsResponse> {
    return this.service.list(user.sub);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createConnectionSchema)) body: CreateConnection,
  ): Promise<ConnectionWithSecret> {
    return this.service.create(user.sub, body);
  }

  @Get(":id")
  detail(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<ConnectionPublic> {
    return this.service.findOwnedPublic(user.sub, id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get(":id/reveal-key")
  revealKey(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
  ): Promise<ConnectionRevealKeyResponse> {
    return this.service.revealApiKey(user.sub, id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("discover")
  discover(
    @Body(new ZodValidationPipe(discoverConnectionRequestSchema)) body: DiscoverConnectionRequest,
  ): Promise<DiscoverConnectionResponse> {
    return this.discoveryService.discover(body);
  }

  // Shallow probe for non-model kinds (currently only gateway).
  // The full `discover` flow above is heavy and model-shaped; this endpoint
  // returns a yes/no + version + a few facts, suitable for an inline "Verify"
  // button next to the kind dropdown.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post("verify-kind")
  async verifyKind(
    @Body(new ZodValidationPipe(verifyKindRequestSchema)) body: VerifyKindRequest,
  ): Promise<VerifyKindResponse> {
    return verifyConnectionKind(body);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateConnectionSchema)) body: UpdateConnection,
  ): Promise<ConnectionWithSecret | ConnectionPublic> {
    return this.service.update(user.sub, id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    await this.service.delete(user.sub, id);
  }
}
