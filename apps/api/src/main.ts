import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter.js";
import type { Env } from "./config/env.schema.js";

async function bootstrap(): Promise<void> {
  const app: INestApplication = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.setGlobalPrefix("api");

  app.useGlobalFilters(new AllExceptionsFilter());

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const origins = config.get("CORS_ORIGINS", { infer: true });
  app.enableCors({
    origin: origins,
    credentials: true,
  });

  const port = config.get("PORT", { infer: true });
  await app.listen(port);
  console.log(`[api] listening on http://localhost:${port}`);
}

void bootstrap();
