import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { RequestIdMiddleware } from "./common/middleware/request-id.middleware.js";
import { AppConfigModule } from "./config/config.module.js";
import type { Env } from "./config/env.schema.js";
import { DebugProxyModule } from "./modules/debug-proxy/debug-proxy.module.js";
import { E2ETestModule } from "./modules/e2e-test/e2e-test.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { LoadTestModule } from "./modules/load-test/load-test.module.js";

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get("LOG_LEVEL", { infer: true }),
          // Correlate with the RequestId middleware
          genReqId: (req) => (req as { id?: string }).id ?? "",
          customProps: (req) => ({ requestId: (req as { id?: string }).id }),
          transport:
            config.get("NODE_ENV", { infer: true }) === "development"
              ? { target: "pino-pretty", options: { singleLine: true, colorize: true } }
              : undefined,
          // Suppress /api/health access logs — too noisy
          autoLogging: {
            ignore: (req: { url?: string }) => req.url === "/api/health",
          },
        },
      }),
    }),
    HealthModule,
    DebugProxyModule,
    E2ETestModule,
    LoadTestModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
