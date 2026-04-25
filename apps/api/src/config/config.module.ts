import { resolve } from "node:path";
import { Module } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";
import { validateEnv } from "./env.schema.js";

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      envFilePath: resolve(__dirname, "../../../..", ".env"),
    }),
  ],
  exports: [NestConfigModule],
})
export class AppConfigModule {}
