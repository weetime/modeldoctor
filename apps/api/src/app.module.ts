import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { HealthModule } from "./modules/health/health.module.js";
import { DebugProxyModule } from "./modules/debug-proxy/debug-proxy.module.js";
import { E2ETestModule } from "./modules/e2e-test/e2e-test.module.js";

@Module({
  imports: [HealthModule, DebugProxyModule, E2ETestModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
