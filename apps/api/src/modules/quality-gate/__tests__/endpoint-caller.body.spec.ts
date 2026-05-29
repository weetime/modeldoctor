import { describe, expect, it } from "vitest";
import { buildRequestBody } from "../endpoint-caller.js";

const gen = (over: Partial<Parameters<typeof buildRequestBody>[2]> = {}) =>
  ({ maxTokens: 2048, temperature: 0, thinking: "auto", ...over }) as Parameters<
    typeof buildRequestBody
  >[2];

describe("buildRequestBody", () => {
  it("maps maxTokens/temperature and omits chat_template_kwargs on auto", () => {
    const b = buildRequestBody("m", "hi", gen()) as Record<string, unknown>;
    expect(b).toMatchObject({ model: "m", max_tokens: 2048, temperature: 0 });
    expect(b.chat_template_kwargs).toBeUndefined();
  });
  it("thinking=off sends enable_thinking:false", () => {
    const b = buildRequestBody("m", "hi", gen({ thinking: "off" })) as Record<string, unknown>;
    expect(b.chat_template_kwargs).toEqual({ enable_thinking: false });
  });
  it("thinking=on sends enable_thinking:true", () => {
    const b = buildRequestBody("m", "hi", gen({ thinking: "on" })) as Record<string, unknown>;
    expect(b.chat_template_kwargs).toEqual({ enable_thinking: true });
  });
  it("includes stop only when non-empty", () => {
    expect((buildRequestBody("m", "hi", gen()) as Record<string, unknown>).stop).toBeUndefined();
    expect(
      (buildRequestBody("m", "hi", gen({ stop: ["\n\n"] })) as Record<string, unknown>).stop,
    ).toEqual(["\n\n"]);
  });
});
