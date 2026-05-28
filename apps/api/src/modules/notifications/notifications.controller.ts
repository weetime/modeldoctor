import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { ChannelsService } from "./channels.service.js";
import { DispatcherService } from "./dispatcher.service.js";
import {
  type CreateChannelDto,
  type CreateSubscriptionDto,
  createChannelSchema,
  createSubscriptionSchema,
  type UpdateChannelDto,
  updateChannelSchema,
} from "./notifications.dto.js";
import { SubscriptionsService } from "./subscriptions.service.js";

@ApiTags("notifications")
@ApiBearerAuth()
@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly channels: ChannelsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly dispatcher: DispatcherService,
  ) {}

  @ApiOperation({ summary: "List notification channels (Slack / Feishu / DingTalk webhooks)" })
  @Get("channels")
  list(@CurrentUser() user: JwtPayload) {
    return this.channels.list(user.sub);
  }

  @ApiOperation({ summary: "Create a notification channel" })
  @Post("channels")
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createChannelSchema)) body: CreateChannelDto,
  ) {
    return this.channels.create(user.sub, body);
  }

  @ApiOperation({ summary: "Update a notification channel" })
  @Patch("channels/:id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateChannelSchema)) body: UpdateChannelDto,
  ) {
    return this.channels.update(user.sub, id, body);
  }

  @ApiOperation({ summary: "Delete a notification channel" })
  @Delete("channels/:id")
  @HttpCode(204)
  async remove(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    await this.channels.delete(user.sub, id);
  }

  @ApiOperation({ summary: "Send a test notification through the channel" })
  @Post("channels/:id/test")
  async test(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    try {
      await this.dispatcher.testChannel(user.sub, id, "Test notification from ModelDoctor");
      return { ok: true };
    } catch (e) {
      // Re-raise NotFoundException so the controller returns a 404 instead of
      // swallowing it as ok=false (channel-not-found is an auth/identity
      // problem, not a transient delivery failure).
      if ((e as { status?: number }).status === 404) throw e;
      return { ok: false, error: (e as Error).message };
    }
  }

  @ApiOperation({ summary: "List notification subscriptions" })
  @Get("subscriptions")
  listSubs(@CurrentUser() user: JwtPayload) {
    return this.subscriptions.list(user.sub);
  }

  @ApiOperation({ summary: "Create a notification subscription" })
  @Post("subscriptions")
  createSub(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createSubscriptionSchema)) body: CreateSubscriptionDto,
  ) {
    return this.subscriptions.create(user.sub, body);
  }

  @ApiOperation({ summary: "Delete a notification subscription" })
  @Delete("subscriptions/:id")
  @HttpCode(204)
  async removeSub(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    await this.subscriptions.delete(user.sub, id);
  }
}
