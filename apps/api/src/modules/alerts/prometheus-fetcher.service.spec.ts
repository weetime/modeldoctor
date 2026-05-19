import type { AlertEvent, PrometheusDatasource } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { PrometheusFetcherService } from "./prometheus-fetcher.service.js";

function makeEvent(over: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id: "evt_1",
    fingerprint: "fp",
    status: "firing",
    severity: "warning",
    scenario: null,
    alertName: "HighLatency",
    connectionId: "conn_a",
    modelName: "m1",
    engine: null,
    instance: null,
    labels: {},
    annotations: {},
    rawPayload: {},
    startsAt: new Date("2026-05-18T14:30:00Z"),
    endsAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as AlertEvent;
}

function mockFetch(ok: boolean, body: unknown, status = ok ? 200 : 500): typeof globalThis.fetch {
  return vi.fn(
    async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  ) as unknown as typeof globalThis.fetch;
}

// 32-byte base64 key for AES-256-GCM (same shape as env validator requires).
const TEST_KEY_B64 = Buffer.alloc(32, 7).toString("base64");

// Stub ConfigService matches the pattern used by prometheus-datasource.service.spec.ts.
const CONFIG_STUB = {
  get: (key: string) => process.env[key],
} as unknown as ConstructorParameters<typeof PrismaService>[0];

describe("PrometheusFetcherService.resolveDatasource", () => {
  let prisma: PrismaService;
  let svc: PrometheusFetcherService;

  beforeEach(async () => {
    prisma = new PrismaService(CONFIG_STUB);
    await prisma.$connect();
    await prisma.connection.deleteMany();
    await prisma.prometheusDatasource.deleteMany();
    // FK: connection.user_id → users.id. Mirror prometheus-datasource.service.spec
    // which upserts a fixed test user before creating connections.
    await prisma.user.upsert({
      where: { email: "u@fetcher-spec" },
      create: { id: "u", email: "u@fetcher-spec", passwordHash: "x", roles: ["user"] },
      update: {},
    });
    svc = new PrometheusFetcherService(prisma, TEST_KEY_B64);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns connection's datasource when bound", async () => {
    const ds = await prisma.prometheusDatasource.create({
      data: { name: "explicit", baseUrl: "https://explicit.com" },
    });
    const conn = await prisma.connection.create({
      data: {
        userId: "u",
        kind: "model",
        name: "m",
        baseUrl: "https://m.com",
        apiKeyCipher: "x",
        model: "gpt",
        category: "chat",
        prometheusDatasourceId: ds.id,
      },
    });
    const r = await svc._test_resolveDatasource(makeEvent({ connectionId: conn.id }));
    expect(r?.id).toBe(ds.id);
  });

  it("falls back to default datasource when connection unbound", async () => {
    const ds = await prisma.prometheusDatasource.create({
      data: { name: "default", baseUrl: "https://default.com", isDefault: true },
    });
    const conn = await prisma.connection.create({
      data: {
        userId: "u",
        kind: "model",
        name: "m",
        baseUrl: "https://m.com",
        apiKeyCipher: "x",
        model: "gpt",
        category: "chat",
      },
    });
    const r = await svc._test_resolveDatasource(makeEvent({ connectionId: conn.id }));
    expect(r?.id).toBe(ds.id);
  });

  it("returns null when no default and connection unbound", async () => {
    const conn = await prisma.connection.create({
      data: {
        userId: "u",
        kind: "model",
        name: "m",
        baseUrl: "https://m.com",
        apiKeyCipher: "x",
        model: "gpt",
        category: "chat",
      },
    });
    const r = await svc._test_resolveDatasource(makeEvent({ connectionId: conn.id }));
    expect(r).toBeNull();
  });

  it("returns null when event has no connectionId and no default", async () => {
    const r = await svc._test_resolveDatasource(makeEvent({ connectionId: null }));
    expect(r).toBeNull();
  });
});

describe("PrometheusFetcherService.resolveExpr", () => {
  let svc: PrometheusFetcherService;
  beforeEach(() => {
    svc = new PrometheusFetcherService({} as PrismaService, TEST_KEY_B64);
  });

  it("returns annotations.expr when present", () => {
    expect(svc._test_resolveExpr(makeEvent({ annotations: { expr: "up == 0" } }))).toBe("up == 0");
  });

  it("falls back to generatorURL?g0.expr=", () => {
    expect(
      svc._test_resolveExpr(
        makeEvent({
          annotations: {},
          rawPayload: {
            generatorURL:
              "http://prom:9090/graph?g0.expr=histogram_quantile%280.95%2C%20rate%28foo%5B5m%5D%29%29&g0.tab=0",
          },
        }),
      ),
    ).toBe("histogram_quantile(0.95, rate(foo[5m]))");
  });

  it("returns null when both absent", () => {
    expect(svc._test_resolveExpr(makeEvent({ annotations: {}, rawPayload: {} }))).toBeNull();
  });

  it("returns null when generatorURL unparseable", () => {
    expect(
      svc._test_resolveExpr(
        makeEvent({ annotations: {}, rawPayload: { generatorURL: "::bad::" } }),
      ),
    ).toBeNull();
  });
});

describe("PrometheusFetcherService.fetchAlertContext (query_range + summarise)", () => {
  let prisma: PrismaService;
  let svc: PrometheusFetcherService;
  let ds: PrometheusDatasource;
  let savedFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    prisma = new PrismaService(CONFIG_STUB);
    await prisma.$connect();
    await prisma.connection.deleteMany();
    await prisma.prometheusDatasource.deleteMany();
    ds = await prisma.prometheusDatasource.create({
      data: { name: "d", baseUrl: "https://prom.test", isDefault: true },
    });
    svc = new PrometheusFetcherService(prisma, TEST_KEY_B64);
    savedFetch = globalThis.fetch;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function restoreFetch() {
    globalThis.fetch = savedFetch;
  }

  it("returns null when datasource resolution fails", async () => {
    await prisma.prometheusDatasource.deleteMany();
    const ctx = await svc.fetchAlertContext(
      makeEvent({ annotations: { expr: "up" }, connectionId: null }),
    );
    expect(ctx).toBeNull();
  });

  it("returns null when expr resolution fails", async () => {
    const ctx = await svc.fetchAlertContext(makeEvent({ annotations: {}, rawPayload: {} }));
    expect(ctx).toBeNull();
  });

  it("returns null when fetch fails (5xx)", async () => {
    globalThis.fetch = mockFetch(false, { error: "boom" }, 500);
    try {
      const ctx = await svc.fetchAlertContext(
        makeEvent({ annotations: { expr: "up" }, connectionId: null }),
      );
      expect(ctx).toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("summarises one series", async () => {
    globalThis.fetch = mockFetch(true, {
      status: "success",
      data: {
        resultType: "matrix",
        result: [
          {
            metric: { __name__: "ttft_p95", model_name: "m1" },
            values: [
              [1747574400, "0.32"],
              [1747574700, "0.41"],
              [1747575120, "0.61"], // peak
              [1747575600, "0.44"],
              [1747576200, "0.58"],
            ],
          },
        ],
      },
    });
    try {
      const ctx = await svc.fetchAlertContext(
        makeEvent({
          annotations: { expr: "ttft_p95{model_name='m1'}" },
          connectionId: null,
        }),
      );
      expect(ctx).not.toBeNull();
      expect(ctx?.datasource.id).toBe(ds.id);
      expect(ctx?.series).toHaveLength(1);
      expect(ctx?.series[0]?.summary.min).toBeCloseTo(0.32, 2);
      expect(ctx?.series[0]?.summary.max).toBeCloseTo(0.61, 2);
      expect(ctx?.series[0]?.summary.last).toBeCloseTo(0.58, 2);
    } finally {
      restoreFetch();
    }
  });

  it("truncates to first 5 series", async () => {
    const result = Array.from({ length: 10 }, (_, i) => ({
      metric: { __name__: "x", i: String(i) },
      values: [[1747574400, "1"]],
    }));
    globalThis.fetch = mockFetch(true, {
      status: "success",
      data: { resultType: "matrix", result },
    });
    try {
      const ctx = await svc.fetchAlertContext(
        makeEvent({ annotations: { expr: "x" }, connectionId: null }),
      );
      expect(ctx?.series).toHaveLength(5);
    } finally {
      restoreFetch();
    }
  });
});
