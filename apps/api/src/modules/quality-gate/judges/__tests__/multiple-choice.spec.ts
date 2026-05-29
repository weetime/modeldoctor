import { describe, expect, it } from "vitest";
import { extractChoice, multipleChoiceJudge } from "../multiple-choice.js";

const ctx = (answer: string) => ({ question: "Q", expected: "", answer });
const mc = (answer: string, labels?: string[]) =>
  ({ kind: "multiple-choice", answer, labels }) as const;

describe("extractChoice", () => {
  const L = ["A", "B", "C", "D"];
  it("bare letter", () => expect(extractChoice("C", L)).toBe("C"));
  it("letter with dot", () => expect(extractChoice("C.", L)).toBe("C"));
  it("letter then option text", () => expect(extractChoice("C. 北京", L)).toBe("C"));
  it("parenthesized", () => expect(extractChoice("(B)", L)).toBe("B"));
  it("marker 答案是", () => expect(extractChoice("答案是 D", L)).toBe("D"));
  it("marker 正确答案：", () => expect(extractChoice("正确答案：A", L)).toBe("A"));
  it("lowercase normalizes", () => expect(extractChoice("答案是 b", L)).toBe("B"));
  it("marker beats earlier distractor letter", () =>
    expect(extractChoice("A 是错的，正确答案是 C", L)).toBe("C"));
  it("ignores latin words, finds standalone", () =>
    expect(extractChoice("The answer is C", L)).toBe("C"));
  it("returns null when no label present", () => expect(extractChoice("不知道", L)).toBeNull());
  it("supports custom labels beyond D", () =>
    expect(extractChoice("我选 E", ["A", "B", "C", "D", "E"])).toBe("E"));
});

describe("multipleChoiceJudge", () => {
  it("passes when extracted choice matches answer", async () => {
    expect(await multipleChoiceJudge.evaluate(mc("C"), ctx("C. 北京"))).toMatchObject({
      passed: true,
    });
  });
  it("fails when wrong option chosen", async () => {
    const r = await multipleChoiceJudge.evaluate(mc("C"), ctx("答案是 A"));
    expect(r.passed).toBe(false);
    expect(r.reason).toContain("C");
  });
  it("case-insensitive answer match", async () => {
    expect(await multipleChoiceJudge.evaluate(mc("b"), ctx("B"))).toMatchObject({
      passed: true,
    });
  });
  it("fails (no crash) when no label found", async () => {
    const r = await multipleChoiceJudge.evaluate(mc("A"), ctx("我不确定"));
    expect(r.passed).toBe(false);
  });
});
