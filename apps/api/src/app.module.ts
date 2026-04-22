import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { HealthModule } from "./modules/health/health.module.js";
import { DebugProxyModule } from "./modules/debug-proxy/debug-proxy.module.js";

@Module({
  imports: [HealthModule, DebugProxyModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
