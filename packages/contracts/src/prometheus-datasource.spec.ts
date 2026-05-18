import { describe, expect, it } from "vitest";
import {
  createPrometheusDatasourceSchema,
  deletePrometheusDatasourceResponseSchema,
  prometheusDatasourcePublicSchema,
  prometheusDatasourceWithSecretSchema,
  updatePrometheusDatasourceSchema,
  verifyPrometheusDatasourceRequestSchema,
  verifyPrometheusDatasourceResponseSchema,
} from "./prometheus-datasource.js";

describe("prometheusDatasourcePublicSchema", () => {
  it("accepts a minimal row", () => {
    const row = {
      id: "cuid_abc",
      name: "primary",
      baseUrl: "https://prom.example.com",
      bearerPreview: "",
      customHeaders: "",
      isDefault: true,
      consumersCount: 0,
      createdAt: "2026-05-18T10:00:00.000Z",
      updatedAt: "2026-05-18T10:00:00.000Z",
    };
    expect(prometheusDatasourcePublicSchema.parse(row)).toEqual(row);
  });

  it("rejects non-url baseUrl", () => {
    expect(() =>
      prometheusDatasourcePublicSchema.parse({
        id: "x",
        name: "p",
        baseUrl: "not-a-url",
        bearerPreview: "",
        customHeaders: "",
        isDefault: false,
        consumersCount: 0,
        createdAt: "2026-05-18T10:00:00.000Z",
        updatedAt: "2026-05-18T10:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("createPrometheusDatasourceSchema", () => {
  it("accepts minimal input (name + baseUrl)", () => {
    const parsed = createPrometheusDatasourceSchema.parse({
      name: "primary",
      baseUrl: "https://prom.example.com",
    });
    expect(parsed.name).toBe("primary");
    expect(parsed.isDefault).toBe(false);
    expect(parsed.customHeaders).toBe("");
  });

  it("accepts bearerToken + customHeaders + isDefault", () => {
    const parsed = createPrometheusDatasourceSchema.parse({
      name: "secondary",
      baseUrl: "https://prom2.example.com",
      bearerToken: "abc123xyz",
      customHeaders: "X-Tenant: foo",
      isDefault: true,
    });
    expect(parsed.bearerToken).toBe("abc123xyz");
    expect(parsed.isDefault).toBe(true);
  });

  it("rejects empty name", () => {
    expect(() =>
      createPrometheusDatasourceSchema.parse({ name: "", baseUrl: "https://x" }),
    ).toThrow();
  });

  it("rejects bearerToken with mid-string tab (control char)", () => {
    // Plan literal was "abc xyz" but a plain space is neither a control char
    // nor leading/trailing whitespace under bearerTokenSchema; switched to
    // \t (a real control char) to honor the test description's intent.
    expect(() =>
      createPrometheusDatasourceSchema.parse({
        name: "p",
        baseUrl: "https://x",
        bearerToken: "abc\txyz",
      }),
    ).toThrow();
  });

  it("rejects bearerToken with leading whitespace", () => {
    expect(() =>
      createPrometheusDatasourceSchema.parse({
        name: "p",
        baseUrl: "https://x",
        bearerToken: " abc",
      }),
    ).toThrow();
  });
});

describe("updatePrometheusDatasourceSchema", () => {
  it("accepts partial", () => {
    expect(updatePrometheusDatasourceSchema.parse({ name: "renamed" })).toEqual({
      name: "renamed",
    });
    expect(updatePrometheusDatasourceSchema.parse({})).toEqual({});
  });
});

describe("verifyPrometheusDatasourceRequestSchema", () => {
  it("requires baseUrl", () => {
    expect(() => verifyPrometheusDatasourceRequestSchema.parse({})).toThrow();
    expect(
      verifyPrometheusDatasourceRequestSchema.parse({ baseUrl: "https://x" }).baseUrl,
    ).toBe("https://x");
  });
});

describe("verifyPrometheusDatasourceResponseSchema", () => {
  it("ok with optional version", () => {
    expect(
      verifyPrometheusDatasourceResponseSchema.parse({ ok: true, version: "2.50" }),
    ).toEqual({
      ok: true,
      version: "2.50",
    });
    expect(
      verifyPrometheusDatasourceResponseSchema.parse({ ok: false, reason: "timeout" }),
    ).toEqual({
      ok: false,
      reason: "timeout",
    });
  });
});

describe("prometheusDatasourceWithSecretSchema", () => {
  it("extends public with plain bearerToken", () => {
    const row = prometheusDatasourceWithSecretSchema.parse({
      id: "cuid_abc",
      name: "p",
      baseUrl: "https://x",
      bearerPreview: "abc...wxyz",
      customHeaders: "",
      isDefault: false,
      consumersCount: 0,
      createdAt: "2026-05-18T10:00:00.000Z",
      updatedAt: "2026-05-18T10:00:00.000Z",
      bearerToken: "abcdefwxyz",
    });
    expect(row.bearerToken).toBe("abcdefwxyz");
  });
});

describe("deletePrometheusDatasourceResponseSchema", () => {
  it("accepts non-negative consumersDetached", () => {
    expect(deletePrometheusDatasourceResponseSchema.parse({ consumersDetached: 0 })).toEqual({ consumersDetached: 0 });
    expect(deletePrometheusDatasourceResponseSchema.parse({ consumersDetached: 3 })).toEqual({ consumersDetached: 3 });
  });

  it("rejects negative consumersDetached", () => {
    expect(() => deletePrometheusDatasourceResponseSchema.parse({ consumersDetached: -1 })).toThrow();
  });
});
