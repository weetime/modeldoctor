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
import {
  createConnectionSchema,
  updateConnectionSchema,
  type Connection,
  type CreateConnection,
  type ListConnectionsResponse,
  type UpdateConnection,
} from "@modeldoctor/contracts";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { ConnectionService } from "./connection.service.js";

@Controller("connections")
@UseGuards(JwtAuthGuard)
export class ConnectionController {
  constructor(private readonly service: ConnectionService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload): Promise<ListConnectionsResponse> {
    return this.service.list(user.sub);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createConnectionSchema)) body: CreateConnection,
  ): Promise<Connection> {
    return this.service.create(user.sub, body);
  }

  @Get(":id")
  detail(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
  ): Promise<Connection> {
    return this.service.findOwned(user.sub, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateConnectionSchema)) body: UpdateConnection,
  ): Promise<Connection> {
    return this.service.update(user.sub, id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
  ): Promise<void> {
    await this.service.delete(user.sub, id);
  }
}
