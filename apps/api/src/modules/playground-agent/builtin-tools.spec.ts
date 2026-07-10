import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { BUILTIN_TOOL_DEFS, BUILTIN_TOOLS, executeBuiltin } from "./builtin-tools.js";

describe("get_current_time", () => {
  it("returns a parseable ISO timestamp", async () => {
    const result = await BUILTIN_TOOLS.get_current_time.run({});
    expect(typeof result).toBe("string");
    const parsed = new Date(result);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(result).toBe(parsed.toISOString());
  });
});

describe("calculator", () => {
  it("evaluates basic arithmetic with correct precedence", async () => {
    await expect(BUILTIN_TOOLS.calculator.run({ expression: "2+3*4" })).resolves.toBe("14");
  });

  it("evaluates expressions with parentheses and decimals", async () => {
    await expect(BUILTIN_TOOLS.calculator.run({ expression: "(2 + 3) * 4.5" })).resolves.toBe(
      "22.5",
    );
  });

  it("rejects expressions containing code/letters", async () => {
    await expect(BUILTIN_TOOLS.calculator.run({ expression: "require('fs')" })).rejects.toThrow();
  });

  it("rejects expressions containing semicolons / statement separators", async () => {
    await expect(BUILTIN_TOOLS.calculator.run({ expression: "1;drop" })).rejects.toThrow();
  });

  it("rejects expressions with bare identifiers", async () => {
    await expect(BUILTIN_TOOLS.calculator.run({ expression: "a+b" })).rejects.toThrow();
  });

  it("rejects non-string / empty expressions", async () => {
    await expect(
      BUILTIN_TOOLS.calculator.run({ expression: 42 as unknown as string }),
    ).rejects.toThrow();
    await expect(BUILTIN_TOOLS.calculator.run({ expression: "   " })).rejects.toThrow();
  });

  it("rejects division by zero", async () => {
    await expect(BUILTIN_TOOLS.calculator.run({ expression: "1/0" })).rejects.toThrow();
  });
});

describe("http_get guards", () => {
  let fetchSpy: MockInstance<typeof globalThis.fetch>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("rejects loopback hosts (localhost)", async () => {
    await expect(BUILTIN_TOOLS.http_get.run({ url: "http://localhost/secret" })).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects the cloud metadata address", async () => {
    await expect(
      BUILTIN_TOOLS.http_get.run({ url: "http://169.254.169.254/latest/meta-data/" }),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects private 10.0.0.0/8 addresses", async () => {
    await expect(BUILTIN_TOOLS.http_get.run({ url: "http://10.0.0.1/" })).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects private 192.168.0.0/16 addresses", async () => {
    await expect(BUILTIN_TOOLS.http_get.run({ url: "http://192.168.1.1/" })).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects private 172.16.0.0/12 addresses", async () => {
    await expect(BUILTIN_TOOLS.http_get.run({ url: "http://172.16.5.5/" })).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects IPv6 loopback", async () => {
    await expect(BUILTIN_TOOLS.http_get.run({ url: "http://[::1]/" })).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects non-http(s) schemes", async () => {
    await expect(BUILTIN_TOOLS.http_get.run({ url: "file:///etc/passwd" })).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects malformed URLs", async () => {
    await expect(BUILTIN_TOOLS.http_get.run({ url: "not a url" })).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects IPv4-mapped IPv6 loopback (::ffff:127.0.0.1)", async () => {
    await expect(
      BUILTIN_TOOLS.http_get.run({ url: "http://[::ffff:127.0.0.1]/" }),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects IPv4-mapped IPv6 cloud metadata address (::ffff:169.254.169.254)", async () => {
    await expect(
      BUILTIN_TOOLS.http_get.run({ url: "http://[::ffff:169.254.169.254]/" }),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects IPv4-mapped IPv6 10.0.0.0/8 addresses (::ffff:10.0.0.1)", async () => {
    await expect(
      BUILTIN_TOOLS.http_get.run({ url: "http://[::ffff:10.0.0.1]/" }),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects IPv4-mapped IPv6 192.168.0.0/16 addresses (::ffff:192.168.1.1)", async () => {
    await expect(
      BUILTIN_TOOLS.http_get.run({ url: "http://[::ffff:192.168.1.1]/" }),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls fetch with a timeout signal and truncates a long body for allowed hosts", async () => {
    const longBody = "x".repeat(20 * 1024);
    fetchSpy.mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(longBody),
    } as Response);

    const result = await BUILTIN_TOOLS.http_get.run({ url: "https://example.com/" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result).toContain("HTTP 200");
    expect(result).toContain("[truncated]");
    expect(result.length).toBeLessThan(longBody.length);
  });
});

describe("executeBuiltin", () => {
  it("dispatches to the named tool", async () => {
    await expect(executeBuiltin("calculator", { expression: "1+1" })).resolves.toBe("2");
  });

  it("throws a clear error for an unknown tool", async () => {
    await expect(executeBuiltin("nope", {})).rejects.toThrow(/unknown built-in tool/i);
  });

  it("throws the clean unknown-tool error for prototype-polluting names", async () => {
    await expect(executeBuiltin("__proto__", {})).rejects.toThrow(/unknown built-in tool/i);
    await expect(executeBuiltin("constructor", {})).rejects.toThrow(/unknown built-in tool/i);
  });
});

describe("BUILTIN_TOOL_DEFS", () => {
  it("exposes one ToolDef per built-in tool", () => {
    expect(BUILTIN_TOOL_DEFS).toHaveLength(Object.keys(BUILTIN_TOOLS).length);
    const names = BUILTIN_TOOL_DEFS.map((d) => d.function.name).sort();
    expect(names).toEqual(["calculator", "get_current_time", "http_get"]);
  });
});
