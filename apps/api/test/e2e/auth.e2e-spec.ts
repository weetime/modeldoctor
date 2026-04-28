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
    expect(res.body.accessTokenExpiresAt).toBeTruthy();
    expect(typeof res.body.accessTokenExpiresAt).toBe("string");
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
    const sessionCookie = cookies.find((c) => c.startsWith("md_session="));
    expect(sessionCookie, "md_session set on register").toBeTruthy();
    expect(sessionCookie).toMatch(/^md_session=1(;|$)/);
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
    expect(res.body.accessTokenExpiresAt).toBeTruthy();
    expect(typeof res.body.accessTokenExpiresAt).toBe("string");
    const rawCookies = res.headers["set-cookie"] as string[] | string | undefined;
    const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
    const refreshCookie = cookies.find((c) => c.startsWith("md_refresh="));
    expect(refreshCookie).toBeTruthy();
    const sessionCookie = cookies.find((c) => c.startsWith("md_session="));
    expect(sessionCookie, "md_session set on register").toBeTruthy();
    expect(sessionCookie).toMatch(/^md_session=1(;|$)/);
  });

  // ── 6. GET /api/auth/me with bearer → PublicUser shape ───────────────────
  it("GET /api/auth/me with bearer → { id, email, roles, createdAt }", async () => {
    const loginRes = await request(ctx.app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "admin@example.com", password: "Password1!" })
      .expect(201);
    expect(loginRes.body.accessToken).toBeTruthy();
    expect(loginRes.body.accessTokenExpiresAt).toBeTruthy();
    expect(typeof loginRes.body.accessTokenExpiresAt).toBe("string");
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
    expect(refreshRes.body.accessTokenExpiresAt).toBeTruthy();
    expect(typeof refreshRes.body.accessTokenExpiresAt).toBe("string");

    const rawCookies = refreshRes.headers["set-cookie"] as string[] | string | undefined;
    const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
    const refreshCookie = cookies.find((c) => c.startsWith("md_refresh="));
    expect(refreshCookie).toBeTruthy();
    const sessionCookie = cookies.find((c) => c.startsWith("md_session="));
    expect(sessionCookie, "md_session set on register").toBeTruthy();
    expect(sessionCookie).toMatch(/^md_session=1(;|$)/);
  });

  // ── Theft detection: outside-grace replay still kills the family ─────────
  it("theft: replaying revoked cookie OUTSIDE grace window → 401 + family revoked", async () => {
    const regRes = await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "theft-test@example.com", password: "Password1!" })
      .expect(201);

    const cookieValueA = (
      (regRes.headers["set-cookie"] as string[]).find((c) => c.startsWith("md_refresh=")) as string
    ).split(";")[0];

    const refreshResB = await request(ctx.app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", cookieValueA)
      .expect(201);
    const cookieValueB = (
      (refreshResB.headers["set-cookie"] as string[]).find((c) =>
        c.startsWith("md_refresh="),
      ) as string
    ).split(";")[0];

    // Force A's revoked_at past the 30s grace window
    const prisma = ctx.app.get(PrismaService);
    const { createHash } = await import("node:crypto");
    const aHash = createHash("sha256").update(cookieValueA.split("=")[1]).digest("hex");
    await prisma.$executeRaw`
      UPDATE "refresh_tokens"
      SET "revoked_at" = NOW() - INTERVAL '60 seconds'
      WHERE "token_hash" = ${aHash}
    `;

    // Now A's replay is outside grace → 401 + family revoked
    await request(ctx.app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", cookieValueA)
      .expect(401);

    // B (the legitimate successor) was in the same family → also 401
    await request(ctx.app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", cookieValueB)
      .expect(401);
  });

  // ── Grace-replay: replaying revoked cookie INSIDE grace returns access token ─
  it("grace replay: replaying revoked cookie INSIDE grace → 201 + accessToken, NO Set-Cookie", async () => {
    const regRes = await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "grace-replay@example.com", password: "Password1!" })
      .expect(201);

    const cookieValueA = (
      (regRes.headers["set-cookie"] as string[]).find((c) => c.startsWith("md_refresh=")) as string
    ).split(";")[0];

    // Rotate once → A is revoked, A' is the live cookie
    await request(ctx.app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", cookieValueA)
      .expect(201);

    // Immediately replay A — within the 30s grace window
    const replay = await request(ctx.app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", cookieValueA)
      .expect(201);

    expect(replay.body.accessToken).toBeTruthy();
    expect(replay.body.accessTokenExpiresAt).toBeTruthy();
    expect(typeof replay.body.accessTokenExpiresAt).toBe("string");
    const setCookieHeader = replay.headers["set-cookie"] as string[] | undefined;
    const hasNewRefreshCookie = !!setCookieHeader?.some((c) => c.startsWith("md_refresh="));
    expect(hasNewRefreshCookie, "grace-replay must NOT rotate cookie").toBe(false);
  });

  // ── Theft on family A does not invalidate family B (concurrent sessions) ──
  it("theft on one family revokes only that family; second session of same user still rotates", async () => {
    await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "two-sessions@example.com", password: "Password1!" })
      .expect(201);

    const loginA = await request(ctx.app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "two-sessions@example.com", password: "Password1!" })
      .expect(201);
    const loginB = await request(ctx.app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "two-sessions@example.com", password: "Password1!" })
      .expect(201);

    const cookieA = (
      (loginA.headers["set-cookie"] as string[]).find((c) => c.startsWith("md_refresh=")) as string
    ).split(";")[0];
    const cookieB = (
      (loginB.headers["set-cookie"] as string[]).find((c) => c.startsWith("md_refresh=")) as string
    ).split(";")[0];

    // Device A rotates A → A'
    await request(ctx.app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", cookieA)
      .expect(201);

    // Force A's revoked_at past grace → outside-grace theft detection on family A
    const prisma = ctx.app.get(PrismaService);
    const { createHash } = await import("node:crypto");
    const aHash = createHash("sha256").update(cookieA.split("=")[1]).digest("hex");
    await prisma.$executeRaw`
      UPDATE "refresh_tokens"
      SET "revoked_at" = NOW() - INTERVAL '60 seconds'
      WHERE "token_hash" = ${aHash}
    `;

    // Replay A → 401 + family A revoked
    await request(ctx.app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", cookieA)
      .expect(401);

    // Device B is a SEPARATE family → still works
    const bRotated = await request(ctx.app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", cookieB)
      .expect(201);
    expect(bRotated.body.accessToken).toBeTruthy();
    expect(bRotated.body.accessTokenExpiresAt).toBeTruthy();
    expect(typeof bRotated.body.accessTokenExpiresAt).toBe("string");
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

  // ── Grace window: concurrent refresh ──────────────────────────────────────
  it("two concurrent /refresh with same cookie → both 201; exactly one rotates cookie", async () => {
    const regRes = await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "concurrent-refresh@example.com", password: "Password1!" })
      .expect(201);

    const rawCookies = regRes.headers["set-cookie"] as string[] | string | undefined;
    const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
    const cookieValue = (
      cookies.find((c) => c.startsWith("md_refresh=")) as string
    ).split(";")[0];

    const [resA, resB] = await Promise.all([
      request(ctx.app.getHttpServer()).post("/api/auth/refresh").set("Cookie", cookieValue),
      request(ctx.app.getHttpServer()).post("/api/auth/refresh").set("Cookie", cookieValue),
    ]);

    expect(resA.status, "first refresh").toBe(201);
    expect(resB.status, "second refresh").toBe(201);
    expect(resA.body.accessToken).toBeTruthy();
    expect(resB.body.accessToken).toBeTruthy();
    expect(resA.body.accessTokenExpiresAt).toBeTruthy();
    expect(typeof resA.body.accessTokenExpiresAt).toBe("string");
    expect(resB.body.accessTokenExpiresAt).toBeTruthy();
    expect(typeof resB.body.accessTokenExpiresAt).toBe("string");

    const aSetsCookie = !!(resA.headers["set-cookie"] as string[] | undefined)?.some((c) =>
      c.startsWith("md_refresh="),
    );
    const bSetsCookie = !!(resB.headers["set-cookie"] as string[] | undefined)?.some((c) =>
      c.startsWith("md_refresh="),
    );
    // Exactly one of the two should rotate the cookie; the loser is grace-replayed.
    expect(aSetsCookie !== bSetsCookie, "exactly one rotates cookie").toBe(true);
  });

  // ── md_session companion cookie ──────────────────────────────────────────
  it("login sets md_session=1 (non-HttpOnly, Path=/); logout clears it", async () => {
    // Register the user first (admin@example.com may not exist in this test ordering;
    // use a fresh user to keep the test self-contained)
    await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "session-cookie@example.com", password: "Password1!" })
      .expect(201);

    const loginRes = await request(ctx.app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "session-cookie@example.com", password: "Password1!" })
      .expect(201);

    const cookies = (loginRes.headers["set-cookie"] as string[]) ?? [];
    const sessionCookie = cookies.find((c) => c.startsWith("md_session="));
    expect(sessionCookie, "md_session present").toBeTruthy();
    expect(sessionCookie).toMatch(/^md_session=1(;|$)/);
    expect(sessionCookie).not.toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/Path=\/(;|$)/);
    expect(sessionCookie).toMatch(/SameSite=Lax/i);

    // Logout should clear both cookies. /logout is behind the global
    // JwtAuthGuard, so we need a Bearer token to reach the handler.
    const accessToken = loginRes.body.accessToken as string;
    const logoutRes = await request(ctx.app.getHttpServer())
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Cookie", (sessionCookie as string).split(";")[0])
      .expect(201);
    const logoutCookies = (logoutRes.headers["set-cookie"] as string[]) ?? [];
    const clearedSession = logoutCookies.find((c) => c.startsWith("md_session="));
    expect(clearedSession, "md_session clear directive").toBeTruthy();
    // Express clearCookie sets Expires to the epoch.
    expect(clearedSession).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });
});
