import path from "node:path";
import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ServeStaticModule } from "@nestjs/serve-static";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { RolesGuard } from "./common/guards/roles.guard.js";
import { RequestIdMiddleware } from "./common/middleware/request-id.middleware.js";
import { AppConfigModule } from "./config/config.module.js";
import type { Env } from "./config/env.schema.js";
import { DatabaseModule } from "./database/database.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { JwtAuthGuard } from "./modules/auth/jwt-auth.guard.js";
import { BaselineModule } from "./modules/baseline/baseline.module.js";
import { BenchmarkModule } from "./modules/benchmark/benchmark.module.js";
import { ConnectionModule } from "./modules/connection/connection.module.js";
import { DebugProxyModule } from "./modules/debug-proxy/debug-proxy.module.js";
import { E2ETestModule } from "./modules/e2e-test/e2e-test.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { LoadTestModule } from "./modules/load-test/load-test.module.js";
import { PlaygroundModule } from "./modules/playground/playground.module.js";
import { RunModule } from "./modules/run/run.module.js";
import { UsersModule } from "./modules/users/users.module.js";

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
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
    ServeStaticModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        if (config.get("NODE_ENV", { infer: true }) !== "production") {
          return []; // empty → no static middleware registered in dev/test
        }
        return [
          {
            // apps/api/dist/main.js is invoked from repo root via `pnpm start`,
            // so cwd === repo root → apps/web/dist is the correct target.
            rootPath: path.resolve(process.cwd(), "apps/web/dist"),
            exclude: ["/api/(.*)", "/api/docs", "/api/docs-json"],
          },
        ];
      },
    }),
    HealthModule,
    DebugProxyModule,
    E2ETestModule,
    LoadTestModule,
    PlaygroundModule,
    RunModule,
    BenchmarkModule,
    ConnectionModule,
    ScheduleModule.forRoot(),
    UsersModule,
    AuthModule,
    BaselineModule,
    ThrottlerModule.forRoot({
      throttlers: [{ name: "default", ttl: 60_000, limit: 100 }],
    }),
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard }, // runs after JwtAuthGuard
    { provide: APP_GUARD, useClass: ThrottlerGuard }, // runs last — throttles by IP
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
