import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/database/prisma.service.js";
import { type E2EContext, bootE2E } from "../helpers/app.js";

describe("Auth (e2e)", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await bootE2E();
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  // ── 1. Register first user → admin role ──────────────────────────────────
  it("register first user → 201, accessToken + refresh cookie, role=admin", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "admin@example.com", password: "Password1!" })
      .expect(201);

    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.email).toBe("admin@example.com");
    expect(res.body.user.roles).toEqual(["admin"]);
    expect(res.body.user.id).toBeTruthy();
    expect(res.body.user.createdAt).toBeTruthy();

    const rawCookies = res.headers["set-cookie"] as string[] | string | undefined;
    const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
    const refreshCookie = cookies.find((c) => c.startsWith("md_refresh="));
    expect(refreshCookie).toBeTruthy();
    expect(refreshCookie).toMatch(/HttpOnly/i);
    expect(refreshCookie).toMatch(/Path=\/api\/auth/i);
  });

  // ── 2. Register second user → role=user ──────────────────────────────────
  it("register second user → role=user", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "user2@example.com", password: "Password1!" })
      .expect(201);

    expect(res.body.user.roles).toEqual(["user"]);
  });

  // ── 3. Duplicate email → 409 ──────────────────────────────────────────────
  it("register duplicate email → 409", async () => {
    await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "admin@example.com", password: "Password1!" })
      .expect(409);
  });

  // ── 4. Login wrong password → 401 ────────────────────────────────────────
  it("login wrong password → 401", async () => {
    await request(ctx.app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "admin@example.com", password: "WRONG_PASSWORD" })
      .expect(401);
  });

  // ── 5. Login correct password → 201, accessToken + refresh cookie ────────
  it("login correct password → 201, accessToken + refresh cookie", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "admin@example.com", password: "Password1!" })
      .expect(201);

    expect(res.body.accessToken).toBeTruthy();
    const rawCookies = res.headers["set-cookie"] as string[] | string | undefined;
    const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
    const refreshCookie = cookies.find((c) => c.startsWith("md_refresh="));
    expect(refreshCookie).toBeTruthy();
  });

  // ── 6. GET /api/auth/me with bearer → PublicUser shape ───────────────────
  it("GET /api/auth/me with bearer → { id, email, roles, createdAt }", async () => {
    const loginRes = await request(ctx.app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "admin@example.com", password: "Password1!" })
      .expect(201);
    const token = loginRes.body.accessToken as string;
    const registeredId = loginRes.body.user.id as string;

    const meRes = await request(ctx.app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(meRes.body.id).toBeTruthy();
    expect(meRes.body.id).toBe(registeredId);
    expect(meRes.body.email).toBe("admin@example.com");
    expect(Array.isArray(meRes.body.roles)).toBe(true);
    expect(meRes.body.createdAt).toBeTruthy();
  });

  // ── 7. GET /api/auth/me WITHOUT bearer → 401 ─────────────────────────────
  it("GET /api/auth/me without bearer → 401", async () => {
    await request(ctx.app.getHttpServer()).get("/api/auth/me").expect(401);
  });

  // ── 8. POST /api/auth/refresh WITHOUT cookie → 401 ───────────────────────
  it("POST /api/auth/refresh without cookie → 401", async () => {
    await request(ctx.app.getHttpServer()).post("/api/auth/refresh").expect(401);
  });

  // ── 9. POST /api/auth/refresh WITH cookie → new accessToken + new cookie ─
  it("POST /api/auth/refresh with cookie → new accessToken + new cookie", async () => {
    // Use an agent so cookie jar is automatically managed for /api/auth path
    const agent = request.agent(ctx.app.getHttpServer());
    await agent
      .post("/api/auth/register")
      .send({ email: "refresh-test@example.com", password: "Password1!" })
      .expect(201);

    const refreshRes = await agent.post("/api/auth/refresh").expect(201);
    expect(refreshRes.body.accessToken).toBeTruthy();

    const rawCookies = refreshRes.headers["set-cookie"] as string[] | string | undefined;
    const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
    const refreshCookie = cookies.find((c) => c.startsWith("md_refresh="));
    expect(refreshCookie).toBeTruthy();
  });

  // ── 10. Theft detection ───────────────────────────────────────────────────
  it("theft detection: replaying revoked cookie revokes all tokens", async () => {
    // Register a fresh user for this test
    const regRes = await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "theft-test@example.com", password: "Password1!" })
      .expect(201);

    // Extract cookie A from register response
    const rawCookiesA = regRes.headers["set-cookie"] as string[] | string | undefined;
    const cookiesA = Array.isArray(rawCookiesA) ? rawCookiesA : rawCookiesA ? [rawCookiesA] : [];
    const cookieStringA = cookiesA.find((c) => c.startsWith("md_refresh="));
    expect(cookieStringA).toBeTruthy();
    // Extract just the "md_refresh=XXX" part (cookieStringA is guaranteed truthy by the expect above)
    const cookieValueA = (cookieStringA as string).split(";")[0];

    // First refresh with cookie A → succeeds, gets new cookie B
    const refreshResB = await request(ctx.app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", cookieValueA)
      .expect(201);
    expect(refreshResB.body.accessToken).toBeTruthy();

    const rawCookiesB = refreshResB.headers["set-cookie"] as string[] | string | undefined;
    const cookiesB = Array.isArray(rawCookiesB) ? rawCookiesB : rawCookiesB ? [rawCookiesB] : [];
    const cookieStringB = cookiesB.find((c) => c.startsWith("md_refresh="));
    expect(cookieStringB).toBeTruthy();
    const cookieValueB = (cookieStringB as string).split(";")[0];

    // Second refresh still using old cookie A (now revoked) → 401 theft detection
    await request(ctx.app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", cookieValueA)
      .expect(401);

    // Third refresh using the new cookie B (all tokens now revoked by theft detection) → 401
    await request(ctx.app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", cookieValueB)
      .expect(401);
  });

  // ── 11. Admin sees runs from all users ────────────────────────────────────
  it("GET /api/load-test/runs with admin token → sees all users' runs", async () => {
    const prisma = ctx.app.get(PrismaService);

    // Re-use the admin account registered in test #1
    const adminLoginRes = await request(ctx.app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "admin@example.com", password: "Password1!" })
      .expect(201);
    const adminToken = adminLoginRes.body.accessToken as string;
    const adminId = adminLoginRes.body.user.id as string;

    // Register another user to own some runs
    const user2Res = await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "rbac-user@example.com", password: "Password1!" })
      .expect(201);
    const user2Id = user2Res.body.user.id as string;

    // Seed runs for both users directly via Prisma
    await prisma.loadTestRun.create({
      data: {
        userId: adminId,
        apiType: "chat",
        apiBaseUrl: "http://admin-run",
        model: "m",
        rate: 1,
        duration: 1,
        status: "completed",
        summaryJson: {},
        rawReport: "",
      },
    });
    await prisma.loadTestRun.create({
      data: {
        userId: user2Id,
        apiType: "chat",
        apiBaseUrl: "http://user2-run",
        model: "m",
        rate: 1,
        duration: 1,
        status: "completed",
        summaryJson: {},
        rawReport: "",
      },
    });

    const adminRunsRes = await request(ctx.app.getHttpServer())
      .get("/api/load-test/runs")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const urls = adminRunsRes.body.items.map((r: { apiBaseUrl: string }) => r.apiBaseUrl);
    expect(urls).toContain("http://admin-run");
    expect(urls).toContain("http://user2-run");
  });

  // ── 12. User sees only own runs ───────────────────────────────────────────
  it("GET /api/load-test/runs with user token → only own runs", async () => {
    const prisma = ctx.app.get(PrismaService);

    const userRes = await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "own-runs-user@example.com", password: "Password1!" })
      .expect(201);
    const userId = userRes.body.user.id as string;
    const userToken = userRes.body.accessToken as string;

    // Seed a run for this user only
    await prisma.loadTestRun.create({
      data: {
        userId,
        apiType: "chat",
        apiBaseUrl: "http://own-run",
        model: "m",
        rate: 1,
        duration: 1,
        status: "completed",
        summaryJson: {},
        rawReport: "",
      },
    });

    const runsRes = await request(ctx.app.getHttpServer())
      .get("/api/load-test/runs")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);

    // All returned runs must belong to this user
    expect(runsRes.body.items.every((r: { userId: string }) => r.userId === userId)).toBe(true);
    expect(runsRes.body.items.some((r: { apiBaseUrl: string }) => r.apiBaseUrl === "http://own-run")).toBe(
      true,
    );
  });
});
