import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { AppModule } from "../../src/app.module.js";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter.js";

describe("DebugProxy (e2e)", () => {
  let app: INestApplication;
  let upstream: http.Server;
  let upstreamUrl: string;

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        if (req.url === "/text") {
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("hello from upstream");
          return;
        }
        if (req.url === "/image") {
          res.setHeader("Content-Type", "image/png");
          res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
          return;
        }
        if (req.url === "/echo-method") {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              method: req.method,
              body: Buffer.concat(chunks).toString(),
            }),
          );
          return;
        }
        res.statusCode = 404;
        res.end("not found");
      });
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    const addr = upstream.address() as AddressInfo;
    upstreamUrl = `http://127.0.0.1:${addr.port}`;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((r) => upstream.close(() => r()));
  });

  it("rejects missing url with 400 and legacy error shape", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/debug/proxy")
      .send({})
      .expect(400);
    expect(res.body).toEqual({
      success: false,
      error: expect.stringContaining("url"),
    });
  });

  it("forwards GET and returns decoded text body", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/debug/proxy")
      .send({ method: "GET", url: `${upstreamUrl}/text` })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.bodyEncoding).toBe("text");
    expect(res.body.body).toBe("hello from upstream");
    expect(res.body.status).toBe(200);
    expect(typeof res.body.timingMs.totalMs).toBe("number");
  });

  it("base64-encodes binary responses", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/debug/proxy")
      .send({ method: "GET", url: `${upstreamUrl}/image` })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.bodyEncoding).toBe("base64");
    expect(Buffer.from(res.body.body, "base64")[0]).toBe(0x89);
  });

  it("forwards POST body", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/debug/proxy")
      .send({
        method: "POST",
        url: `${upstreamUrl}/echo-method`,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      })
      .expect(200);
    const echo = JSON.parse(res.body.body);
    expect(echo.method).toBe("POST");
    expect(JSON.parse(echo.body)).toEqual({ hello: "world" });
  });

  it("returns success:false with timeout message on abort", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/debug/proxy")
      .send({
        method: "GET",
        url: "http://10.255.255.1",
        timeoutMs: 100,
      })
      .expect(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/timeout|aborted|fetch/i);
  });
});
