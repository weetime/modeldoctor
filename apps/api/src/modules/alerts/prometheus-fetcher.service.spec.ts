import type { AlertEvent, PrometheusDatasource } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import type { PrometheusFetcherConfig } from "./prometheus-fetcher.config.js";
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

// Permissive fetcher config: no SSRF restrictions, 5 MiB body cap.
const PERMISSIVE_FETCHER_CONFIG: PrometheusFetcherConfig = {
  guard: { blockPrivate: false, allowHosts: null },
  maxBodyBytes: 5_242_880,
};

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
    svc = new PrometheusFetcherService(prisma, TEST_KEY_B64, PERMISSIVE_FETCHER_CONFIG);
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
    svc = new PrometheusFetcherService(
      {} as PrismaService,
      TEST_KEY_B64,
      PERMISSIVE_FETCHER_CONFIG,
    );
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
    svc = new PrometheusFetcherService(prisma, TEST_KEY_B64, PERMISSIVE_FETCHER_CONFIG);
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

  it("returns null when Prometheus replies 200 with status='error' envelope", async () => {
    // Mirrors the contract: even on HTTP 200, a Prometheus error envelope
    // (status: "error", errorType, error) is not a usable result and the
    // fetcher must drop the snapshot rather than feed garbage to the LLM.
    globalThis.fetch = mockFetch(true, {
      status: "error",
      errorType: "bad_data",
      error: "parse error at char 1",
    });
    try {
      const ctx = await svc.fetchAlertContext(
        makeEvent({ annotations: { expr: "broken{" }, connectionId: null }),
      );
      expect(ctx).toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("returns null when fetch throws (timeout / network) instead of hanging", async () => {
    // Abort budget is 5s — we don't want to actually wait. Simulate the
    // post-abort error the global fetch throws when AbortController fires.
    globalThis.fetch = vi.fn(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    }) as unknown as typeof globalThis.fetch;
    try {
      const ctx = await svc.fetchAlertContext(
        makeEvent({ annotations: { expr: "up" }, connectionId: null }),
      );
      // The catch in queryRange logs + returns null; the explainer keeps
      // generating a baseline-only narrative without crashing.
      expect(ctx).toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("returns null when bearerCipher decrypt fails (rotated env key)", async () => {
    // Plant a cipher encrypted under a different key, then construct the
    // service with our test key. decrypt() throws → the catch in queryRange
    // returns null without ever calling fetch (we'd notice if it did because
    // fetch is unmocked here and prom.test isn't reachable from the suite).
    const otherKey = Buffer.alloc(32, 9).toString("base64"); // ≠ TEST_KEY_B64
    const { encrypt, decodeKey } = await import("../../common/crypto/aes-gcm.js");
    const cipher = encrypt("real-bearer-token", decodeKey(otherKey));
    await prisma.prometheusDatasource.update({
      where: { id: ds.id },
      data: { bearerCipher: cipher },
    });

    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    try {
      const ctx = await svc.fetchAlertContext(
        makeEvent({ annotations: { expr: "up" }, connectionId: null }),
      );
      expect(ctx).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      restoreFetch();
    }
  });
});

describe("PrometheusFetcherService.fetchAlertContext — hardening", () => {
  let prisma: PrismaService;
  let savedFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    prisma = new PrismaService(CONFIG_STUB);
    await prisma.$connect();
    await prisma.prometheusDatasource.deleteMany();
    savedFetch = globalThis.fetch;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function restoreFetch() {
    globalThis.fetch = savedFetch;
  }

  it("1. private IP rejected when blockPrivate=true — fetch never called", async () => {
    await prisma.prometheusDatasource.create({
      data: { name: "priv", baseUrl: "http://10.0.0.5:9090", isDefault: true },
    });
    const svc = new PrometheusFetcherService(prisma, TEST_KEY_B64, {
      guard: { blockPrivate: true, allowHosts: null },
      maxBodyBytes: 5_242_880,
    });
    const fetchSpy = vi.fn(async () => {
      throw new Error("fetch should not have been called");
    });
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    try {
      const ctx = await svc.fetchAlertContext(
        makeEvent({ annotations: { expr: "up" }, connectionId: null }),
      );
      expect(ctx).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      restoreFetch();
    }
  });

  it("2. host outside allowHosts rejected — fetch never called", async () => {
    await prisma.prometheusDatasource.create({
      data: { name: "lab", baseUrl: "http://prom.lab:9090", isDefault: true },
    });
    const svc = new PrometheusFetcherService(prisma, TEST_KEY_B64, {
      guard: { blockPrivate: false, allowHosts: ["prom-other.lab"] },
      maxBodyBytes: 5_242_880,
    });
    const fetchSpy = vi.fn(async () => {
      throw new Error("fetch should not have been called");
    });
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    try {
      const ctx = await svc.fetchAlertContext(
        makeEvent({ annotations: { expr: "up" }, connectionId: null }),
      );
      expect(ctx).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      restoreFetch();
    }
  });

  it("3. redirect to disallowed host rejected — only one fetch attempted", async () => {
    await prisma.prometheusDatasource.create({
      data: { name: "lab", baseUrl: "http://prom.lab:9090", isDefault: true },
    });
    const svc = new PrometheusFetcherService(prisma, TEST_KEY_B64, {
      guard: { blockPrivate: false, allowHosts: ["prom.lab"] },
      maxBodyBytes: 5_242_880,
    });
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: "http://evil.example/data" },
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    try {
      const ctx = await svc.fetchAlertContext(
        makeEvent({ annotations: { expr: "up" }, connectionId: null }),
      );
      expect(ctx).toBeNull();
      // Only one fetch call: the initial request that returned the redirect.
      // The redirect target (evil.example) fails evaluateUrl, so no second fetch.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      restoreFetch();
    }
  });

  it("4. more than 2 redirect hops rejected", async () => {
    await prisma.prometheusDatasource.create({
      data: { name: "perm", baseUrl: "https://prom.test:9090", isDefault: true },
    });
    const svc = new PrometheusFetcherService(prisma, TEST_KEY_B64, PERMISSIVE_FETCHER_CONFIG);
    // Three consecutive 302s: initial + 2 redirects = 3 fetches (the limit).
    // The 3rd fetch is also a 302 → throws "exceeded 2 redirect hops".
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://prom.test:9090/hop2" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://prom.test:9090/hop3" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://prom.test:9090/hop4" },
        }),
      ) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchSpy;
    try {
      const ctx = await svc.fetchAlertContext(
        makeEvent({ annotations: { expr: "up" }, connectionId: null }),
      );
      expect(ctx).toBeNull();
      // Three fetches attempted, then the limit fires.
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    } finally {
      restoreFetch();
    }
  });

  it("4b. exactly 2 redirect hops allowed — terminal 200 reaches caller", async () => {
    await prisma.prometheusDatasource.create({
      data: { name: "perm2", baseUrl: "https://prom.test:9090", isDefault: true },
    });
    const svc = new PrometheusFetcherService(prisma, TEST_KEY_B64, PERMISSIVE_FETCHER_CONFIG);
    // Two redirects then a real success — the body shape mirrors the
    // permissive success-path tests above so summariseSeries works.
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://prom.test:9090/hop2" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://prom.test:9090/hop3" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "success",
            data: {
              resultType: "matrix",
              result: [{ metric: { __name__: "up" }, values: [[1, "1"]] }],
            },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchSpy;
    try {
      const ctx = await svc.fetchAlertContext(
        makeEvent({ annotations: { expr: "up" }, connectionId: null }),
      );
      expect(ctx).not.toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    } finally {
      restoreFetch();
    }
  });

  it("5. body over maxBodyBytes aborted — result is null", async () => {
    await prisma.prometheusDatasource.create({
      data: { name: "large", baseUrl: "https://prom.test:9090", isDefault: true },
    });
    const svc = new PrometheusFetcherService(prisma, TEST_KEY_B64, {
      guard: { blockPrivate: false, allowHosts: null },
      maxBodyBytes: 100,
    });
    // Build a body that is clearly > 100 bytes.
    const largeBody = JSON.stringify({
      status: "success",
      data: {
        result: [{ metric: {}, values: [[1, "x".repeat(2000)]] }],
      },
    });
    globalThis.fetch = vi.fn(
      async () => new Response(largeBody, { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    try {
      const ctx = await svc.fetchAlertContext(
        makeEvent({ annotations: { expr: "up" }, connectionId: null }),
      );
      expect(ctx).toBeNull();
    } finally {
      restoreFetch();
    }
  });
});
