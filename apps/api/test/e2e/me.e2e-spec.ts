import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type E2EContext, bootE2E, registerUser } from "../helpers/app.js";

const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("/api/me (e2e)", () => {
  let ctx: E2EContext;
  let token: string;
  const email = `me-${Date.now()}@test.local`;
  const password = "Password1!";

  beforeAll(async () => {
    ctx = await bootE2E();
    const reg = await registerUser(ctx.app, email, password);
    token = reg.token;
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  // ── 1. GET /api/me → returns user with null displayName / avatarUrl ────────
  it("GET /api/me → 200 with displayName: null and avatarUrl: null after registration", async () => {
    const res = await request(ctx.app.getHttpServer())
      .get("/api/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.email).toBe(email);
    expect(res.body.id).toBeTruthy();
    expect(res.body.roles).toBeDefined();
    expect(res.body.createdAt).toBeTruthy();
    expect(res.body.displayName).toBeNull();
    expect(res.body.avatarUrl).toBeNull();
  });

  // ── 2. PATCH /api/me → updates displayName ────────────────────────────────
  it("PATCH /api/me → 200 with updated displayName", async () => {
    const res = await request(ctx.app.getHttpServer())
      .patch("/api/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ displayName: "Alice Tester" })
      .expect(200);

    expect(res.body.displayName).toBe("Alice Tester");
    expect(res.body.email).toBe(email);
  });

  // ── 3. PATCH /api/me → rejects invalid avatarUrl with 400 ─────────────────
  it("PATCH /api/me → 400 for invalid avatarUrl (javascript: scheme)", async () => {
    await request(ctx.app.getHttpServer())
      .patch("/api/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ avatarUrl: "javascript:alert(1)" })
      .expect(400);
  });

  // ── 4. PATCH /api/me → accepts a data:image/* URL and echoes it back ──────
  it("PATCH /api/me → 200 with data:image/* URL echoed back unchanged", async () => {
    const res = await request(ctx.app.getHttpServer())
      .patch("/api/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ avatarUrl: TINY_PNG_DATA_URL })
      .expect(200);

    expect(res.body.avatarUrl).toBe(TINY_PNG_DATA_URL);
  });

  // ── 5. POST /api/me/password → 401 with wrong currentPassword ─────────────
  it("POST /api/me/password → 401 with wrong currentPassword", async () => {
    await request(ctx.app.getHttpServer())
      .post("/api/me/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "WrongPassword9!", newPassword: "NewPassword1!" })
      .expect(401);
  });

  // ── 6. POST /api/me/password → 204, then login with new password succeeds ──
  it("POST /api/me/password → 204 with correct currentPassword; new password accepted on login", async () => {
    const newPassword = "NewPassword2@";

    await request(ctx.app.getHttpServer())
      .post("/api/me/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: password, newPassword })
      .expect(204);

    // Login with new password must succeed and return the user's email
    const loginRes = await request(ctx.app.getHttpServer())
      .post("/api/auth/login")
      .send({ email, password: newPassword })
      .expect(201);

    expect(loginRes.body.user.email).toBe(email);
  });
});
