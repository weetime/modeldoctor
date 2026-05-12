import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { json, urlencoded } from "express";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter.js";
import type { Env } from "./config/env.schema.js";

async function bootstrap(): Promise<void> {
  const app: INestApplication = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.setGlobalPrefix("api");

  app.useGlobalFilters(new AllExceptionsFilter());

  app.use(cookieParser());

  // Bump JSON body limit. The default ~100 KB rejects benchmark runner
  // metrics callbacks: a guidellm run with 500+ requests posts a
  // rawMetrics blob that can exceed 16 MB once per-request entries are
  // included (observed: 413 against /api/internal/benchmarks/:id/finish).
  // 64 MB covers realistic max-requests=1000 runs while still capping a
  // malicious upload. The throttler (100 req/min global) prevents
  // body-size DoS amplification. Long-term: stream the report to object
  // storage and have the callback carry only a reference path.
  app.use(json({ limit: "64mb" }));
  app.use(urlencoded({ limit: "64mb", extended: true }));

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const origins = config.get("CORS_ORIGINS", { infer: true });
  app.enableCors({
    origin: origins,
    credentials: true,
  });

  // Note: nestjs-zod 5 dropped patchNestJsSwagger. Zod schemas in
  // controllers will surface as generic objects in /api/docs UI rather
  // than typed properties. Tracked as follow-up; @nestjs/swagger 11
  // upstream recommends migrating individual DTOs to ZodResponse-based
  // decorators when schema-aware OpenAPI is needed.
  const swaggerConfig = new DocumentBuilder()
    .setTitle("ModelDoctor API")
    .setDescription("Troubleshooting toolkit for model-serving APIs")
    .setVersion("0.1.0")
    .addBearerAuth() // used starting Phase 5
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, document, {
    jsonDocumentUrl: "api/docs-json",
  });

  const port = config.get("PORT", { infer: true });
  await app.listen(port);
  console.log(`[api] listening on http://localhost:${port}`);
}

void bootstrap();
