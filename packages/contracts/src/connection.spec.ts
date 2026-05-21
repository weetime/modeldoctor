import { describe, expect, it } from "vitest";
import {
  createConnectionSchema,
  discoverConnectionRequestSchema,
  discoverConnectionResponseSchema,
  inferenceConfidenceSchema,
  serverKindSchema,
  updateConnectionSchema,
} from "./connection.js";
import { ENGINE_IDS } from "./engine.js";

const validBase = {
  name: "vllm-prod",
  baseUrl: "http://10.0.0.1:8000",
  model: "qwen2.5",
  customHeaders: "",
  queryParams: "",
  category: "chat" as const,
  tags: [],
};

describe("createConnectionSchema — apiKey validation", () => {
  it("accepts a normal apiKey", () => {
    const result = createConnectionSchema.safeParse({
      ...validBase,
      apiKey: "sk-test-abc123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty apiKey", () => {
    const result = createConnectionSchema.safeParse({
      ...validBase,
      apiKey: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects apiKey with newline (control character)", () => {
    const result = createConnectionSchema.safeParse({
      ...validBase,
      apiKey: "sk-test\nwith-newline",
    });
    expect(result.success).toBe(false);
  });

  it("rejects apiKey with tab character (control character)", () => {
    const result = createConnectionSchema.safeParse({
      ...validBase,
      apiKey: "sk-test\twith-tab",
    });
    expect(result.success).toBe(false);
  });

  it("rejects apiKey with leading whitespace", () => {
    const result = createConnectionSchema.safeParse({
      ...validBase,
      apiKey: " sk-test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects apiKey with trailing whitespace", () => {
    const result = createConnectionSchema.safeParse({
      ...validBase,
      apiKey: "sk-test ",
    });
    expect(result.success).toBe(false);
  });

  it("accepts apiKey with shell metacharacters (POSIX-safe via parameter expansion)", () => {
    // POSIX 2.6.5: parameter expansion result is not re-parsed.
    // These chars are safe in sh -c '... "$VAR" ...'; testing them
    // at the schema layer confirms we don't over-reject real-world keys.
    const result = createConnectionSchema.safeParse({
      ...validBase,
      apiKey: 'sk-test$(rm)`backtick`"quote',
    });
    expect(result.success).toBe(true);
  });
});

describe("serverKindSchema after engine SSOT extraction", () => {
  it("accepts every EngineId plus generic", () => {
    for (const id of ENGINE_IDS) {
      expect(serverKindSchema.parse(id)).toBe(id);
    }
    expect(serverKindSchema.parse("generic")).toBe("generic");
  });

  it("rejects 'higress' (gateways are NOT engines — see connection.ts header)", () => {
    expect(() => serverKindSchema.parse("higress")).toThrow();
  });

  it("rejects unknown values", () => {
    expect(() => serverKindSchema.parse("nope")).toThrow();
  });
});

describe("discoverConnectionRequestSchema", () => {
  it("accepts baseUrl-only input", () => {
    const r = discoverConnectionRequestSchema.parse({ baseUrl: "http://10.0.0.1:8000" });
    expect(r.baseUrl).toBe("http://10.0.0.1:8000");
    expect(r.apiKey).toBeUndefined();
  });

  it("accepts baseUrl + apiKey", () => {
    const r = discoverConnectionRequestSchema.parse({
      baseUrl: "https://api.openai.com",
      apiKey: "sk-test",
    });
    expect(r.apiKey).toBe("sk-test");
  });

  it("rejects non-URL baseUrl", () => {
    expect(() => discoverConnectionRequestSchema.parse({ baseUrl: "not-a-url" })).toThrow();
  });

  it("rejects empty apiKey", () => {
    expect(() =>
      discoverConnectionRequestSchema.parse({ baseUrl: "http://x", apiKey: "" }),
    ).toThrow();
  });

  it("accepts customHeaders string (Higress routing case)", () => {
    const r = discoverConnectionRequestSchema.parse({
      baseUrl: "http://gateway:8000",
      customHeaders: "x-higress-llm-model: qwen-72b\nX-Project-Id: p_123",
    });
    expect(r.customHeaders).toBe("x-higress-llm-model: qwen-72b\nX-Project-Id: p_123");
  });
});

describe("inferenceConfidenceSchema", () => {
  it.each(["certain", "likely", "guess", "unknown"] as const)("accepts %s", (v) => {
    expect(inferenceConfidenceSchema.parse(v)).toBe(v);
  });

  it("rejects unknown value", () => {
    expect(() => inferenceConfidenceSchema.parse("maybe")).toThrow();
  });
});

describe("createConnectionSchema — required model-endpoint fields", () => {
  // Every Connection is a model endpoint, so apiKey/model/category are
  // always required. No more kind-conditional relaxation.
  it("rejects when apiKey is missing", () => {
    const r = createConnectionSchema.safeParse({
      name: "n",
      baseUrl: "http://x",
      model: "m",
      category: "chat",
      customHeaders: "",
      queryParams: "",
      tags: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects when model is missing", () => {
    const r = createConnectionSchema.safeParse({
      name: "n",
      baseUrl: "http://x",
      apiKey: "sk-x",
      category: "chat",
      customHeaders: "",
      queryParams: "",
      tags: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects when category is missing", () => {
    const r = createConnectionSchema.safeParse({
      name: "n",
      baseUrl: "http://x",
      apiKey: "sk-x",
      model: "m",
      customHeaders: "",
      queryParams: "",
      tags: [],
    });
    expect(r.success).toBe(false);
  });

  it("accepts the full v1 contract", () => {
    const r = createConnectionSchema.safeParse({
      ...validBase,
      apiKey: "sk-x",
    });
    expect(r.success).toBe(true);
  });
});

describe("updateConnectionSchema — partial PATCH semantics", () => {
  it("accepts a single-field PATCH", () => {
    const r = updateConnectionSchema.safeParse({ name: "renamed" });
    expect(r.success).toBe(true);
  });

  it("rejects an apiKey reset to empty string when supplied", () => {
    const r = updateConnectionSchema.safeParse({ apiKey: "" });
    expect(r.success).toBe(false);
  });

  it("accepts a PATCH that only touches prometheusDatasourceId (null = unbind)", () => {
    const r = updateConnectionSchema.safeParse({ prometheusDatasourceId: null });
    expect(r.success).toBe(true);
  });
});

describe("createConnectionSchema — prometheusDatasourceId", () => {
  it("accepts prometheusDatasourceId as a string", () => {
    const parsed = createConnectionSchema.parse({
      ...validBase,
      apiKey: "sk-abc",
      prometheusDatasourceId: "ds_abc",
    });
    expect(parsed.prometheusDatasourceId).toBe("ds_abc");
  });

  it("accepts null prometheusDatasourceId (explicit unbind)", () => {
    const parsed = createConnectionSchema.parse({
      ...validBase,
      apiKey: "sk-abc",
      prometheusDatasourceId: null,
    });
    expect(parsed.prometheusDatasourceId).toBeNull();
  });

  it("accepts undefined prometheusDatasourceId (server fills with default datasource)", () => {
    const parsed = createConnectionSchema.parse({
      ...validBase,
      apiKey: "sk-abc",
    });
    expect(parsed.prometheusDatasourceId).toBeUndefined();
  });
});

describe("discoverConnectionResponseSchema", () => {
  it("parses a complete response", () => {
    const valid = {
      health: {
        durationMs: 1234,
        probesAttempted: 4,
        probesFailed: [{ probe: "metrics", reason: "404" }],
        warnings: [],
      },
      inferred: {
        serverKind: { value: "vllm", confidence: "certain", evidence: "metric prefix" },
        models: { values: ["llama-3-8b"], confidence: "certain", evidence: "/v1/models" },
        category: { value: "chat", confidence: "guess", evidence: "default" },
        suggestedTags: { values: ["vllm", "chat", "8b"], confidence: "guess", evidence: "..." },
        prometheusUrl: {
          value: "http://10.0.0.1:8000",
          confidence: "likely",
          evidence: "engine exposes /metrics directly",
        },
      },
    };
    expect(() => discoverConnectionResponseSchema.parse(valid)).not.toThrow();
  });

  it("accepts unknown values as null", () => {
    const valid = {
      health: { durationMs: 100, probesAttempted: 4, probesFailed: [], warnings: [] },
      inferred: {
        serverKind: { value: null, confidence: "unknown", evidence: "no signal" },
        models: { values: [], confidence: "unknown", evidence: "endpoint unreachable" },
        category: { value: null, confidence: "unknown", evidence: "no models" },
        suggestedTags: { values: [], confidence: "unknown", evidence: "no signal" },
        prometheusUrl: { value: null, confidence: "unknown", evidence: "no /metrics" },
      },
    };
    expect(() => discoverConnectionResponseSchema.parse(valid)).not.toThrow();
  });
});
