import * as fs from "node:fs";
import * as path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/database/prisma.service.js";
import { ReportLoader } from "../../src/modules/benchmark/storage/report-loader.js";
import { bootE2E, registerUser, type E2EContext, type RegisteredUser } from "../helpers/app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Guidellm report fixture — same file used by packages/tool-adapters unit tests
const GUIDELLM_REPORT_BUF = fs.readFileSync(
  path.join(
    __dirname,
    "../../../../packages/tool-adapters/src/guidellm/__fixtures__/report.json",
  ),
);

const s3Mock = mockClient(S3Client);

function bodyOf(s: string) {
  return Readable.from([Buffer.from(s, "utf8")]) as never;
}

let ctx: E2EContext;
let user: RegisteredUser;
let prisma: PrismaService;
let loader: ReportLoader;

beforeAll(async () => {
  ctx = await bootE2E();
  user = await registerUser(ctx.app, `watcher-primary-${Date.now()}@example.com`);
  prisma = ctx.app.get(PrismaService);
  loader = ctx.app.get(ReportLoader);
}, 180_000);

afterAll(async () => {
  if (ctx) await ctx.teardown();
});

beforeEach(() => s3Mock.reset());
afterEach(() => s3Mock.reset());

async function seedBenchmark(id: string) {
  return prisma.benchmark.create({
    data: {
      id,
      userId: user.user.id,
      status: "running",
      tool: "guidellm",
      scenario: "inference",
      name: `e2e-${id}`,
      params: {},
      connectionId: null,
    },
  });
}

describe("Benchmark watcher primary mode (e2e)", () => {
  it("Succeeded pod → ReportLoader reads S3 → status=completed + summaryMetrics + toolVersion", async () => {
    const benchId = "00000000-0000-0000-0000-000000000a01";
    await seedBenchmark(benchId);

    // Mock S3 — result.json references a "report" file alias so loadFiles reads it
    s3Mock.on(GetObjectCommand, { Key: `${benchId}/meta.json` }).resolves({
      Body: bodyOf(
        JSON.stringify({ toolVersion: "guidellm 0.2.1", startTimeIso: "2026-05-25T00:00:00.000Z" }),
      ),
    } as never);
    s3Mock.on(GetObjectCommand, { Key: `${benchId}/result.json` }).resolves({
      Body: bodyOf(
        JSON.stringify({
          exitCode: 0,
          finishTimeIso: "2026-05-25T01:00:00.000Z",
          // "report" alias maps to files/report.json — consumed by guidellm.parseFinalReport
          files: { report: "files/report.json" },
        }),
      ),
    } as never);
    s3Mock.on(GetObjectCommand, { Key: `${benchId}/stdout.log` }).resolves({
      Body: bodyOf("PROGRESS:1.0\nDone"),
    } as never);
    s3Mock.on(GetObjectCommand, { Key: `${benchId}/stderr.log` }).resolves({
      Body: bodyOf(""),
    } as never);
    // guidellm report file used by parseFinalReport
    s3Mock.on(GetObjectCommand, { Key: `${benchId}/files/report.json` }).resolves({
      Body: Readable.from([GUIDELLM_REPORT_BUF]) as never,
    } as never);

    await loader.tryLoad(benchId);

    const row = await prisma.benchmark.findUniqueOrThrow({ where: { id: benchId } });
    expect(row.status).toBe("completed");
    expect(row.toolVersion).toBe("guidellm 0.2.1");
    expect(row.completedAt).toBeTruthy();
    expect(row.summaryMetrics).not.toBeNull();
  });

  it("Succeeded pod but S3 returns NoSuchKey → status=failed + statusMessage contains 'report load'", async () => {
    const benchId = "00000000-0000-0000-0000-000000000a02";
    await seedBenchmark(benchId);

    s3Mock
      .on(GetObjectCommand)
      .rejects(Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" }));

    await loader.tryLoad(benchId);

    const row = await prisma.benchmark.findUniqueOrThrow({ where: { id: benchId } });
    expect(row.status).toBe("failed");
    expect(row.statusMessage).toContain("report load");
    expect(row.completedAt).toBeTruthy();
  });

  it("benchmark already terminal → noop (S3 not read)", async () => {
    const benchId = "00000000-0000-0000-0000-000000000a03";
    await prisma.benchmark.create({
      data: {
        id: benchId,
        userId: user.user.id,
        status: "cancelled",
        tool: "guidellm",
        scenario: "inference",
        name: "e2e-cancelled",
        params: {},
        connectionId: null,
        completedAt: new Date("2026-05-24T00:00:00.000Z"),
      },
    });

    let s3Called = false;
    s3Mock.on(GetObjectCommand).callsFake(() => {
      s3Called = true;
      throw new Error("should not be called");
    });

    await loader.tryLoad(benchId);

    expect(s3Called).toBe(false);
    const row = await prisma.benchmark.findUniqueOrThrow({ where: { id: benchId } });
    expect(row.status).toBe("cancelled");
  });
});
