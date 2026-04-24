import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../../src/app.module.js";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { type TestDatabase, startPostgres } from "./postgres-container.js";

export interface E2EContext {
  app: INestApplication;
  db: TestDatabase;
  teardown: () => Promise<void>;
}

/**
 * Boots AppModule against a fresh testcontainer Postgres. Mirrors main.ts's
 * setGlobalPrefix / filters / cookieParser wiring so e2e specs see the
 * same surface as production.
 */
export async function bootE2E(): Promise<E2EContext> {
  const db = await startPostgres();
  process.env.DATABASE_URL = db.url;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("api");
  app.useGlobalFilters(new AllExceptionsFilter());
  app.use(cookieParser());
  await app.init();

  return {
    app,
    db,
    teardown: async () => {
      const prisma = app.get(PrismaService);
      await prisma.$disconnect();
      await app.close();
      await db.teardown();
    },
  };
}

export interface RegisteredUser {
  token: string;
  user: { id: string; email: string; roles: string[]; createdAt: string };
  cookies: string[];
}

export async function registerUser(
  app: INestApplication,
  email: string,
  password = "password123",
): Promise<RegisteredUser> {
  const res = await request(app.getHttpServer())
    .post("/api/auth/register")
    .send({ email, password })
    .expect(201);
  const rawCookies = res.headers["set-cookie"];
  const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
  return { token: res.body.accessToken, user: res.body.user, cookies };
}
