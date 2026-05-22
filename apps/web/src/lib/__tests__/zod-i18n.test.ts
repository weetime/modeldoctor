import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import i18n from "@/lib/i18n";

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

describe("zod errorMap → i18n", () => {
  it("translates required (string min 1) in zh-CN", () => {
    const result = z.string().min(1).safeParse("");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("此项为必填");
    }
  });

  it("translates required (undefined) in zh-CN", () => {
    const result = z.string().safeParse(undefined);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("此项为必填");
    }
  });

  it("translates email in zh-CN", () => {
    const result = z.string().email().safeParse("not-an-email");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("邮箱格式不正确");
    }
  });

  it("translates url in zh-CN", () => {
    const result = z.string().url().safeParse("nope");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("URL 格式不正确");
    }
  });

  it("interpolates min/max in tooShort/tooLong", () => {
    const short = z.string().min(3).safeParse("a");
    expect(short.success).toBe(false);
    if (!short.success) expect(short.error.issues[0].message).toBe("至少需要 3 个字符");

    const long = z.string().max(2).safeParse("abcd");
    expect(long.success).toBe(false);
    if (!long.success) expect(long.error.issues[0].message).toBe("最多 2 个字符");
  });

  it("switches to en-US after changeLanguage", async () => {
    await i18n.changeLanguage("en-US");
    const result = z.string().min(1).safeParse("");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("This field is required");
    }
  });

  // zod v3 short-circuits the errorMap when `.refine(message: …)` is set
  // explicitly, so `validation.*` keys reach the parsed error verbatim.
  // Translation happens at render time inside <FormMessage>; these two cases
  // pin that contract: schema-level keeps the key intact regardless of
  // whether it's known or unknown to common.json.
  it("refine message with validation.* key is left unchanged at safeParse level", () => {
    const schema = z.string().refine(() => false, { message: "validation.invalidUrl" });
    const result = schema.safeParse("anything");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("validation.invalidUrl");
  });

  it("refine message with unknown validation.* key is also kept verbatim", () => {
    const schema = z.string().refine(() => false, { message: "validation.notInCommonJson" });
    const result = schema.safeParse("anything");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("validation.notInCommonJson");
  });
});
