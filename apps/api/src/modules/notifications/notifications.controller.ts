import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { PrismaService } from "../../database/prisma.service.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { ChannelsService } from "./channels.service.js";
import { DispatcherService } from "./dispatcher.service.js";
import {
  type CreateChannelDto,
  type CreateSubscriptionDto,
  type UpdateChannelDto,
  createChannelSchema,
  createSubscriptionSchema,
  updateChannelSchema,
} from "./notifications.dto.js";
import { SubscriptionsService } from "./subscriptions.service.js";

@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly channels: ChannelsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly dispatcher: DispatcherService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("channels")
  list(@CurrentUser() user: JwtPayload) {
    return this.channels.list(user.sub);
  }

  @Post("channels")
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createChannelSchema)) body: CreateChannelDto,
  ) {
    return this.channels.create(user.sub, body);
  }

  @Patch("channels/:id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateChannelSchema)) body: UpdateChannelDto,
  ) {
    return this.channels.update(user.sub, id, body);
  }

  @Delete("channels/:id")
  @HttpCode(204)
  async remove(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    await this.channels.delete(user.sub, id);
  }

  @Post("channels/:id/test")
  async test(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    const rows = await this.channels.list(user.sub);
    if (!rows.find((c) => c.id === id)) throw new BadRequestException("Channel not found");
    const delivery = await this.prisma.notificationDelivery.create({
      data: {
        channelId: id,
        eventType: "test",
        payload: { message: "Test notification from ModelDoctor" },
      },
    });
    try {
      await this.dispatcher.dispatchById(delivery.id);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  @Get("subscriptions")
  listSubs(@CurrentUser() user: JwtPayload) {
    return this.subscriptions.list(user.sub);
  }

  @Post("subscriptions")
  createSub(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createSubscriptionSchema)) body: CreateSubscriptionDto,
  ) {
    return this.subscriptions.create(user.sub, body);
  }

  @Delete("subscriptions/:id")
  @HttpCode(204)
  async removeSub(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    await this.subscriptions.delete(user.sub, id);
  }
}
