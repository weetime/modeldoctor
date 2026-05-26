import { PassThrough } from "node:stream";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { AppModule } from "../../src/app.module.js";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { K8S_LOG_CLIENT } from "../../src/modules/benchmark/k8s/pod-log-streamer-factory.js";
import { PodLogStreamerPool } from "../../src/modules/benchmark/k8s/pod-log-streamer-pool.js";
import { SseHub } from "../../src/modules/benchmark/sse/sse-hub.service.js";
import { startPostgres, type TestDatabase } from "../helpers/postgres-container.js";
import type { INestApplication } from "@nestjs/common";
import type { ProgressEvent } from "@modeldoctor/tool-adapters";

/** Local boot helper — same shape as bootE2E but overrides K8S_LOG_CLIENT. */
async function bootE2EWithLogMock(mockK8sLog: {
  log: (...args: unknown[]) => Promise<{ abort(): void }>;
}): Promise<{ app: INestApplication; db: TestDatabase; teardown: () => Promise<void> }> {
  const db = await startPostgres();
  process.env.DATABASE_URL = db.url;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(K8S_LOG_CLIENT)
    .useValue(mockK8sLog)
    .compile();
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

// ── mock K8s log client ─────────────────────────────────────────────────────
// One passthrough per test suite — reset between tests via beforeEach.
let passthrough: PassThrough;
let logCallCount: number;
const mockK8sLog = {
  log: async (
    _ns: string,
    _pod: string,
    _container: string,
    sink: NodeJS.WritableStream,
    _opts?: unknown,
  ): Promise<{ abort(): void }> => {
    logCallCount += 1;
    // RBAC probe (onModuleInit) targets "__rbac-probe__"; it expects the
    // await to resolve without a 403. Don't pipe — the probe discards the sink.
    if (_pod === "__rbac-probe__") {
      return { abort: () => {} };
    }
    // Real streamer calls: pipe our test PassThrough into the streamer's sink.
    passthrough.pipe(sink as PassThrough);
    return { abort: () => passthrough.destroy() };
  },
};

let ctx: { app: INestApplication; db: TestDatabase; teardown: () => Promise<void> };
let prisma: PrismaService;
let pool: PodLogStreamerPool;
let sse: SseHub;

beforeAll(async () => {
  ctx = await bootE2EWithLogMock(mockK8sLog);
  prisma = ctx.app.get(PrismaService);
  pool = ctx.app.get(PodLogStreamerPool);
  sse = ctx.app.get(SseHub);
}, 180_000);

afterAll(async () => {
  if (ctx) await ctx.teardown();
});

beforeEach(() => {
  passthrough = new PassThrough();
  logCallCount = 0;
});

afterEach(async () => {
  // Destroy any leftover passthrough to avoid open handles.
  if (!passthrough.destroyed) passthrough.destroy();
});

// ── helper: seed a running benchmark ───────────────────────────────────────
let userSeq = 0;
async function seedRunningBenchmark(id: string) {
  // Create a throwaway user per call so foreign-key constraint is met.
  const email = `pod-log-${id}-${++userSeq}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: "x",
    },
  });
  return prisma.benchmark.create({
    data: {
      id,
      userId: user.id,
      status: "running",
      tool: "guidellm",
      scenario: "inference",
      name: `e2e-pod-log-${id}`,
      params: {},
      connectionId: null,
    },
  });
}

describe("pod log stream e2e", () => {
  it("happy path: pool.start → handleLine → SseHub subscription → drainAndStop teardown", async () => {
    const benchId = "00000000-0000-0000-0000-b0b000000001";
    await seedRunningBenchmark(benchId);

    // Subscribe BEFORE pushing lines so we don't miss any events.
    const captured: ProgressEvent[] = [];
    const sub = sse.subscribe(benchId).subscribe((evt) => captured.push(evt));

    // Start the streamer — this calls mockK8sLog.log() which pipes our passthrough.
    pool.start(benchId, "pod-guidellm-1", "guidellm");

    // Give the streamer a tick to wire up the readline interface and call k8sLog.log.
    await new Promise((r) => setTimeout(r, 20));

    // Push lines. guidellm's parseProgress always returns null, so these don't
    // produce SSE events — but they do reach handleLine and go through readline.
    passthrough.write("Benchmark started\n");
    passthrough.write("Processing requests...\n");

    // EOF: signals the streamer that the stream is done (clean exit path).
    passthrough.end();

    // drainAndStop should resolve quickly because the stream ended cleanly.
    await pool.drainAndStop(benchId, 3000);

    // Cleanup subscription.
    sub.unsubscribe();

    // ── assertions ─────────────────────────────────────────────────────────
    // Pool correctly tore down the entry.
    expect(pool.has(benchId)).toBe(false);

    // mockK8sLog.log() was called at least once for the real streamer (the RBAC
    // probe call happened during onModuleInit before this test, so logCallCount
    // here only reflects calls within this test's beforeEach-reset window).
    expect(logCallCount).toBeGreaterThanOrEqual(1);

    // DB row still exists (no status change expected from log-only path).
    const row = await prisma.benchmark.findUniqueOrThrow({ where: { id: benchId } });
    expect(row.status).toBe("running");
  });

  it("RBAC probe smoke: AppModule boots successfully with mocked K8S_LOG_CLIENT", async () => {
    // If onModuleInit threw (e.g. 403-like error from mock), bootE2E would have
    // rejected and ctx would be undefined — the beforeAll would have failed.
    // Reaching this test proves the mock handled the __rbac-probe__ call cleanly.
    expect(ctx.app).toBeDefined();
    expect(pool).toBeDefined();
    expect(sse).toBeDefined();
  });
});
