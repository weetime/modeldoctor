import { Module } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";
import { validateEnv } from "./env.schema.js";

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      // Default envFilePath resolves to `${cwd}/.env`. When running via
      // `pnpm -F @modeldoctor/api start:dev` cwd is `apps/api/`, so the
      // app's own `.env` is loaded — per-app convention, no path-resolve
      // gymnastics. CI / prod inject env vars directly and the absence of
      // a .env file is handled silently by @nestjs/config.
    }),
  ],
  exports: [NestConfigModule],
})
export class AppConfigModule {}
