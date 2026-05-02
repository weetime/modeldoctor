import { describe, expect, it } from "vitest";
import * as schemas from "./schemas-entry.js";

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
