import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import {
  type CreateSubscriberDto,
  type UpdateSubscriberDto,
  createSubscriberSchema,
  updateSubscriberSchema,
} from "./subscribers.dto.js";
import { SubscribersService } from "./subscribers.service.js";

@Controller("connections/:connectionId/subscribers")
export class SubscribersController {
  constructor(private readonly service: SubscribersService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload, @Param("connectionId") connectionId: string) {
    return this.service.list(user.sub, connectionId);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Param("connectionId") connectionId: string,
    @Body(new ZodValidationPipe(createSubscriberSchema)) body: CreateSubscriberDto,
  ) {
    return this.service.create(user.sub, connectionId, body);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("connectionId") connectionId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSubscriberSchema)) body: UpdateSubscriberDto,
  ) {
    return this.service.update(user.sub, connectionId, id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param("connectionId") connectionId: string,
    @Param("id") id: string,
  ): Promise<void> {
    await this.service.delete(user.sub, connectionId, id);
  }
}
