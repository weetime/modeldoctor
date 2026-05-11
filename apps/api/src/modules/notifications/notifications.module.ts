import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "../../database/database.module.js";
import { ChannelsService } from "./channels.service.js";
import { DispatcherService } from "./dispatcher.service.js";
import { NotificationsController } from "./notifications.controller.js";
import { NotifyService } from "./notify.service.js";
import { SubscriptionsService } from "./subscriptions.service.js";

@Module({
  imports: [DatabaseModule, ConfigModule],
  controllers: [NotificationsController],
  providers: [ChannelsService, SubscriptionsService, NotifyService, DispatcherService],
  exports: [ChannelsService, SubscriptionsService, NotifyService, DispatcherService],
})
export class NotificationsModule {}
