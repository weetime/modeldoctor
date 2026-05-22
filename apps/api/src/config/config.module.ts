import { Module } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";
import { validateEnv } from "./env.schema.js";

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      // Per-environment env file resolution. Matches NestJS sample / Spring
      // Boot profile / Rails environments convention: test isolation lives
      // at the loading layer, not in env.schema.ts (which is uniformly
      // required across envs since #223). cwd is `apps/api/` under
      // `pnpm -F @modeldoctor/api …` and under vitest workers — no path
      // resolve gymnastics. CI / prod inject env vars directly and the
      // absence of a .env file is handled silently by @nestjs/config.
      envFilePath: process.env.NODE_ENV === "test" ? ".env.test" : ".env",
    }),
  ],
  exports: [NestConfigModule],
})
export class AppConfigModule {}
