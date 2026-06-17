import { describe, expect, it } from "vitest";
import { appendExtraArgs, ExtraArgsError, parseExtraArgs } from "../extra-args.js";

describe("parseExtraArgs", () => {
  it("returns [] for empty / undefined / whitespace", () => {
    expect(parseExtraArgs(undefined)).toEqual([]);
    expect(parseExtraArgs("")).toEqual([]);
    expect(parseExtraArgs("   \n\t ")).toEqual([]);
  });

  it("splits on whitespace and newlines", () => {
    expect(parseExtraArgs("--a 1\n--b 2")).toEqual(["--a", "1", "--b", "2"]);
  });

  it("keeps a single-quoted JSON value as one token, joined to its prefix", () => {
    // The thinking-off flag: the quoted JSON must survive as ONE value token.
    expect(
      parseExtraArgs(`--extra-inputs chat_template_kwargs:'{"enable_thinking":false}'`),
    ).toEqual(["--extra-inputs", `chat_template_kwargs:{"enable_thinking":false}`]);
  });

  it("supports double quotes with escaped quotes", () => {
    expect(parseExtraArgs(`--x "a \\"b\\" c"`)).toEqual(["--x", `a "b" c`]);
  });

  it("throws ExtraArgsError on an unterminated quote", () => {
    expect(() => parseExtraArgs(`--x 'oops`)).toThrow(ExtraArgsError);
  });
});

describe("appendExtraArgs", () => {
  const locked = new Set(["--model", "--url", "--api-key"]);

  it("appends parsed tokens after the base argv", () => {
    expect(appendExtraArgs(["aiperf", "profile"], "--warmup-request-count 50", locked)).toEqual([
      "aiperf",
      "profile",
      "--warmup-request-count",
      "50",
    ]);
  });

  it("is a no-op for undefined / empty extraArgs", () => {
    expect(appendExtraArgs(["x"], undefined, locked)).toEqual(["x"]);
    expect(appendExtraArgs(["x"], "  ", locked)).toEqual(["x"]);
  });

  it("rejects a locked flag (bare and =form)", () => {
    expect(() => appendExtraArgs(["x"], "--model evil", locked)).toThrow(ExtraArgsError);
    expect(() => appendExtraArgs(["x"], "--url=http://evil", locked)).toThrow(/--url/);
  });

  it("allows unknown flags (the whole point)", () => {
    expect(appendExtraArgs(["x"], "--brand-new-flag yes", locked)).toEqual([
      "x",
      "--brand-new-flag",
      "yes",
    ]);
  });
});
