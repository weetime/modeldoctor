import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter.js";

async function bootstrap(): Promise<void> {
  const app: INestApplication = await NestFactory.create(AppModule);

  app.setGlobalPrefix("api");

  app.useGlobalFilters(new AllExceptionsFilter());

  // Dev-time CORS: Vite dev server runs on 5173; browser calls here hit the
  // Vite proxy server-to-server, so CORS is not strictly needed for the FE
  // dev loop. But developers occasionally curl/fetch the API from other
  // origins (notebooks, Postman browser), and permissive dev CORS is harmless.
  // Production CORS policy is revisited in Phase 2 with @nestjs/config.
  if (process.env.NODE_ENV !== "production") {
    app.enableCors({
      origin: ["http://localhost:5173"],
      credentials: true,
    });
  }

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`[api] listening on http://localhost:${port}`);
}

void bootstrap();
