import { describe, expect, it } from "vitest";
import * as schemas from "./schemas-entry.js";
import {
  GENAI_PERF_CATEGORY_DEFAULTS,
  GUIDELLM_CATEGORY_DEFAULTS,
  VEGETA_API_TYPE_TO_BODY,
  VEGETA_API_TYPE_TO_PATH,
  VEGETA_CATEGORY_DEFAULTS,
  migrateVegetaParams,
} from "./schemas-entry.js";

describe("schemas-entry", () => {
  it("exports guidellm schemas", () => {
    expect(schemas.guidellmParamsSchema).toBeDefined();
    expect(schemas.guidellmReportSchema).toBeDefined();
  });

  it("exports vegeta schemas", () => {
    expect(schemas.vegetaParamsSchema).toBeDefined();
    expect(schemas.vegetaReportSchema).toBeDefined();
  });

  it("exports genai-perf schemas", () => {
    expect(schemas.genaiPerfParamsSchema).toBeDefined();
    expect(schemas.genaiPerfReportSchema).toBeDefined();
  });

  it("does NOT export adapter (which contains runtime)", () => {
    // Adapter object aggregates runtime fns; the schema-entry must not.
    // (TypeScript-level guard; this assertion is a runtime safety net.)
    expect((schemas as Record<string, unknown>).guidellmAdapter).toBeUndefined();
    expect((schemas as Record<string, unknown>).vegetaAdapter).toBeUndefined();
    expect((schemas as Record<string, unknown>).genaiPerfAdapter).toBeUndefined();
  });
});

describe("schemas-entry — task 5 re-exports", () => {
  it("re-exports VEGETA_API_TYPE_TO_PATH / _BODY", () => {
    expect(VEGETA_API_TYPE_TO_PATH.embeddings).toBe("/v1/embeddings");
    expect(typeof VEGETA_API_TYPE_TO_BODY.chat).toBe("function");
  });
  it("re-exports migrateVegetaParams", () => {
    const out = migrateVegetaParams({ apiType: "chat", rate: 1, duration: 1 }, "m");
    expect(out.path).toBe("/v1/chat/completions");
  });
  it("re-exports the three CATEGORY_DEFAULTS maps", () => {
    expect(VEGETA_CATEGORY_DEFAULTS.embeddings).toEqual({ apiType: "embeddings" });
    expect(GENAI_PERF_CATEGORY_DEFAULTS.audio).toEqual({ unsupported: true });
    expect(GUIDELLM_CATEGORY_DEFAULTS.image).toEqual({ unsupported: true });
  });
});
