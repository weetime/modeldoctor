import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { json, urlencoded } from "express";
import { Logger } from "nestjs-pino";
import { patchNestJsSwagger } from "nestjs-zod";
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
  // metrics callbacks: a 1k-request guidellm run posts a rawMetrics blob
  // that is several MB. 16 MB is plenty for any realistic benchmark
  // payload while still capping a malicious upload. The throttler
  // (100 req/min global) prevents body-size DoS amplification.
  app.use(json({ limit: "16mb" }));
  app.use(urlencoded({ limit: "16mb", extended: true }));

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const origins = config.get("CORS_ORIGINS", { infer: true });
  app.enableCors({
    origin: origins,
    credentials: true,
  });

  patchNestJsSwagger();
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
