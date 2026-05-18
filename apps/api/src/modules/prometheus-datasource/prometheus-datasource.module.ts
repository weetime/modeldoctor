import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema.js";
import { PrometheusDatasourceController } from "./prometheus-datasource.controller.js";
import {
  PROMETHEUS_DS_ENC_KEY,
  PrometheusDatasourceService,
} from "./prometheus-datasource.service.js";

@Module({
  imports: [ConfigModule],
  controllers: [PrometheusDatasourceController],
  providers: [
    PrometheusDatasourceService,
    {
      // Same env var the ConnectionService and LlmJudgeService read directly via
      // ConfigService. Centralising it as a DI value here keeps the service
      // testable with a literal base64 key (see service spec).
      provide: PROMETHEUS_DS_ENC_KEY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const k = config.get("CONNECTION_API_KEY_ENCRYPTION_KEY", { infer: true });
        if (!k) throw new Error("CONNECTION_API_KEY_ENCRYPTION_KEY is required");
        return k;
      },
    },
  ],
  exports: [PrometheusDatasourceService],
})
export class PrometheusDatasourceModule {}
