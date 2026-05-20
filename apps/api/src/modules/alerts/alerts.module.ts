import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema.js";
import { DatabaseModule } from "../../database/database.module.js";
import { LlmJudgeModule } from "../llm-judge/llm-judge.module.js";
import { PROMETHEUS_DS_ENC_KEY } from "../prometheus-datasource/prometheus-datasource.service.js";
import { AlertsController } from "./alerts.controller.js";
import { AlertsService } from "./alerts.service.js";
import { AlertExplainerService } from "./explainer.service.js";
import {
  PROMETHEUS_FETCHER_CONFIG,
  type PrometheusFetcherConfig,
} from "./prometheus-fetcher.config.js";
import { PrometheusFetcherService } from "./prometheus-fetcher.service.js";
import { SubscribersController } from "./subscribers.controller.js";
import { SubscribersService } from "./subscribers.service.js";

export type { PrometheusFetcherConfig };
export { PROMETHEUS_FETCHER_CONFIG };

@Module({
  imports: [DatabaseModule, ConfigModule, LlmJudgeModule],
  controllers: [AlertsController, SubscribersController],
  providers: [
    AlertsService,
    AlertExplainerService,
    SubscribersService,
    PrometheusFetcherService,
    {
      // PROMETHEUS_DS_ENC_KEY is also provided by PrometheusDatasourceModule.
      // Re-providing here (same factory + env var) keeps AlertsModule
      // independent — the explainer pipeline doesn't transitively need the
      // datasource CRUD controller and its DI graph.
      provide: PROMETHEUS_DS_ENC_KEY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const k = config.get("CONNECTION_API_KEY_ENCRYPTION_KEY", { infer: true });
        if (!k) throw new Error("CONNECTION_API_KEY_ENCRYPTION_KEY is required");
        return k;
      },
    },
    {
      provide: PROMETHEUS_FETCHER_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): PrometheusFetcherConfig => {
        const raw = config.get("PROMETHEUS_FETCH_ALLOW_HOSTS", { infer: true });
        const allowHosts =
          raw && raw.trim().length > 0
            ? raw
                .split(",")
                .map((h) => h.trim())
                .filter((h) => h.length > 0)
            : null;
        return {
          guard: {
            blockPrivate: config.get("PROMETHEUS_FETCH_BLOCK_PRIVATE", { infer: true }),
            allowHosts,
          },
          maxBodyBytes: config.get("PROMETHEUS_FETCH_MAX_BODY_BYTES", { infer: true }),
        };
      },
    },
  ],
  exports: [AlertsService, SubscribersService],
})
export class AlertsModule {}
