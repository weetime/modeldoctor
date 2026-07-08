import { describe, expect, it } from "vitest";
import { createMcpServerSchema, mcpServerPublicSchema } from "./mcp-server.js";

describe("mcp-server contracts", () => {
  it("create requires name + url(http)", () => {
    const v = createMcpServerSchema.parse({
      name: "gw",
      url: "https://higress.local/mcp",
      transport: "http",
    });
    expect(v.transport).toBe("http");
  });

  it("rejects non-url", () => {
    expect(() => createMcpServerSchema.parse({ name: "x", url: "not a url" })).toThrow();
  });

  it("public shape omits authToken", () => {
    const p = mcpServerPublicSchema.parse({
      id: "m1",
      name: "gw",
      url: "https://h/mcp",
      transport: "http",
      headers: "",
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect("authTokenCipher" in p).toBe(false);
  });
});
