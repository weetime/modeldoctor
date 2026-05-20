import { describe, expect, it } from "vitest";
import {
  connectionKindSchema,
  createConnectionSchema,
  discoverConnectionRequestSchema,
  discoverConnectionResponseSchema,
  inferenceConfidenceSchema,
  serverKindSchema,
  updateConnectionSchema,
  verifyKindRequestSchema,
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
  it("accepts every EngineId plus higress + generic", () => {
    for (const id of ENGINE_IDS) {
      expect(serverKindSchema.parse(id)).toBe(id);
    }
    expect(serverKindSchema.parse("higress")).toBe("higress");
    expect(serverKindSchema.parse("generic")).toBe("generic");
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

describe("connectionKindSchema", () => {
  it("only allows model/gateway", () => {
    expect(connectionKindSchema.options).toEqual(["model", "gateway"]);
  });

  it.each(["model", "gateway"] as const)("accepts %s", (v) => {
    expect(connectionKindSchema.parse(v)).toBe(v);
  });

  it("rejects prometheus (now modeled as its own PrometheusDatasource entity)", () => {
    expect(() => connectionKindSchema.parse("prometheus")).toThrow();
  });

  it("rejects alertmanager (retired — AM pushes via webhook, not modeled)", () => {
    expect(() => connectionKindSchema.parse("alertmanager")).toThrow();
  });

  it("rejects unknown kind", () => {
    expect(() => connectionKindSchema.parse("database")).toThrow();
  });
});

describe("createConnectionSchema — kind=non-model relaxes required fields", () => {
  const nonModelBase = {
    name: "prom-1",
    baseUrl: "http://prom:9090",
    customHeaders: "",
    queryParams: "",
    tags: [],
  };

  it("kind=gateway accepts omitted apiKey/model/category", () => {
    // gateway is auth-optional (apiKey may live in upstream model, not gateway).
    const r = createConnectionSchema.safeParse({ ...nonModelBase, kind: "gateway" });
    expect(r.success).toBe(true);
  });

  it("kind defaults to 'model' when omitted, still requiring full v1 contract", () => {
    const r = createConnectionSchema.safeParse(nonModelBase);
    expect(r.success).toBe(false); // missing apiKey/model/category for kind=model
  });

  it("kind=model still requires apiKey/model/category", () => {
    const r = createConnectionSchema.safeParse({ ...nonModelBase, kind: "model" });
    expect(r.success).toBe(false);
  });
});

describe("updateConnectionSchema — partial PATCH semantics", () => {
  it("accepts a single-field PATCH without kind", () => {
    // This is exactly the shape the gemini security comment flagged: a
    // partial PATCH without kind passes the contract layer; the service
    // layer is responsible for re-enforcing kind-specific invariants.
    const r = updateConnectionSchema.safeParse({ model: "" });
    expect(r.success).toBe(true);
  });

  it("when kind=model is explicit in the PATCH, refine fires (empty apiKey rejected)", () => {
    const r = updateConnectionSchema.safeParse({ kind: "model", apiKey: "" });
    expect(r.success).toBe(false);
  });
});

describe("verifyKindRequestSchema", () => {
  it("accepts kind + baseUrl alone", () => {
    const r = verifyKindRequestSchema.parse({
      kind: "gateway",
      baseUrl: "http://higress:8080",
    });
    expect(r.kind).toBe("gateway");
  });

  it("accepts optional apiKey + customHeaders", () => {
    const r = verifyKindRequestSchema.parse({
      kind: "gateway",
      baseUrl: "http://higress",
      apiKey: "sk-x",
      customHeaders: "X-Project: p1",
    });
    expect(r.apiKey).toBe("sk-x");
    expect(r.customHeaders).toBe("X-Project: p1");
  });

  it("rejects empty apiKey when supplied", () => {
    expect(() =>
      verifyKindRequestSchema.parse({ kind: "gateway", baseUrl: "http://x", apiKey: "" }),
    ).toThrow();
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

describe("createConnectionSchema — prometheusDatasourceId", () => {
  it("accepts prometheusDatasourceId on kind=model", () => {
    const parsed = createConnectionSchema.parse({
      kind: "model",
      name: "m",
      baseUrl: "https://m.example.com",
      apiKey: "sk-abc",
      model: "gpt-4",
      category: "chat",
      prometheusDatasourceId: "ds_abc",
    });
    expect(parsed.prometheusDatasourceId).toBe("ds_abc");
  });

  it("accepts null prometheusDatasourceId (explicit unbind)", () => {
    const parsed = createConnectionSchema.parse({
      kind: "gateway",
      name: "g",
      baseUrl: "https://g.example.com",
      prometheusDatasourceId: null,
    });
    expect(parsed.prometheusDatasourceId).toBeNull();
  });

  it("accepts undefined prometheusDatasourceId (server fills with default datasource)", () => {
    const parsed = createConnectionSchema.parse({
      kind: "gateway",
      name: "g",
      baseUrl: "https://g.example.com",
    });
    expect(parsed.prometheusDatasourceId).toBeUndefined();
  });
});

