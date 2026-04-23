import { Module } from "@nestjs/common";
import { AppConfigModule } from "./config/config.module.js";
import { DebugProxyModule } from "./modules/debug-proxy/debug-proxy.module.js";
import { E2ETestModule } from "./modules/e2e-test/e2e-test.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { LoadTestModule } from "./modules/load-test/load-test.module.js";

@Module({
  imports: [AppConfigModule, HealthModule, DebugProxyModule, E2ETestModule, LoadTestModule],
})
export class AppModule {}
