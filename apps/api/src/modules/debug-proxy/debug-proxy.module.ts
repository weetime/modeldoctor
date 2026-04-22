import { Module } from "@nestjs/common";
import { DebugProxyController } from "./debug-proxy.controller.js";
import { DebugProxyService } from "./debug-proxy.service.js";

@Module({
  controllers: [DebugProxyController],
  providers: [DebugProxyService],
})
export class DebugProxyModule {}
