import { describe, expect, it } from "vitest";
import type { BuildCommandPlan } from "../core/interface.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import { vllmOmniBenchParamsSchema } from "./schema.js";

const plan = (over: Partial<BuildCommandPlan["connection"]> = {}): BuildCommandPlan => ({
  runId: "bm-1",
  params: vllmOmniBenchParamsSchema.parse({}),
  connection: {
    baseUrl: "http://10.100.121.67:30888/",
    apiKey: "sk-secret",
    model: "gen-studio_Qwen2.5-Omni-7B-OFEd",
    customHeaders: "",
    queryParams: "",
    tokenizerHfId: "Qwen/Qwen2.5-Omni-7B",
    prometheusDatasource: null,
    ...over,
  },
});

describe("buildCommand", () => {
  it("launches the omni driver with the env contract; secret only in secretEnv", () => {
    const r = buildCommand(plan());
    expect(r.argv).toEqual(["python", "-m", "runner.tools.omni_driver"]);
    expect(r.env.MD_OMNI_BASE_URL).toBe("http://10.100.121.67:30888"); // 尾斜杠剥掉
    expect(r.env.MD_OMNI_MODEL).toBe("gen-studio_Qwen2.5-Omni-7B-OFEd");
    expect(r.env.MD_OMNI_TOKENIZER_HF_ID).toBe("Qwen/Qwen2.5-Omni-7B");
    expect(JSON.parse(r.env.MD_OMNI_PARAMS).concurrencyLevels).toEqual([1, 8, 16, 32]);
    expect(r.secretEnv).toEqual({ OPENAI_API_KEY: "sk-secret" });
    expect(JSON.stringify(r.argv)).not.toContain("sk-secret");
    expect(r.outputFiles).toEqual({ report: "out/omni_result.json" });
  });
  it("rejects customHeaders/queryParams (v1 cannot forward them to vllm bench)", () => {
    expect(() => buildCommand(plan({ customHeaders: '{"X-A":"1"}' }))).toThrow(/customHeaders/);
    expect(() => buildCommand(plan({ queryParams: "a=b" }))).toThrow(/queryParams/);
  });
  it("omits MD_OMNI_TOKENIZER_HF_ID when connection has none (driver fails fast with guidance)", () => {
    const r = buildCommand(plan({ tokenizerHfId: null }));
    expect(r.env.MD_OMNI_TOKENIZER_HF_ID).toBeUndefined();
  });
});

describe("parseFinalReport", () => {
  it("parses the driver result file into the report union", () => {
    const data = {
      curve: [{
        arm: "audio", concurrency: 1, status: "ok", reqPerSec: 0.5, outTokPerSec: 100,
        ttftMs: { mean: 66, p50: 60, p99: 120 },
        e2elMs: { mean: 8000, p50: 7900, p99: 9000 },
        audioTtfpMs: { mean: 511, p50: 490, p99: 900 },
        audioRtf: { mean: 0.19, p50: 0.18, p99: 0.3 },
      }],
      derived: { realtimeCeiling: 1, peakConcurrency: 1, voiceTaxMsByLevel: {}, voiceTaxMs: null },
      warnings: [],
    };
    const out = parseFinalReport("", { report: Buffer.from(JSON.stringify(data)) });
    expect(out.tool).toBe("vllm-omni-bench");
  });
  it("throws when the report file is missing", () => {
    expect(() => parseFinalReport("", {})).toThrow(/missing 'report'/);
  });
});

describe("getMaxDurationSeconds", () => {
  it("scales with arms × levels × per-point timeout", () => {
    const p = vllmOmniBenchParamsSchema.parse({}); // 4 档 × 2 臂 × 900s + 300
    expect(getMaxDurationSeconds(p)).toBe(4 * 2 * 900 + 300);
  });
  it("halves without the voice-tax arm", () => {
    const p = vllmOmniBenchParamsSchema.parse({ voiceTax: false });
    expect(getMaxDurationSeconds(p)).toBe(4 * 900 + 300);
  });
});

describe("parseProgress", () => {
  it("reads the driver's point-progress lines", () => {
    const ev = parseProgress("[omni-driver] point arm=audio c=8 done (3/8)");
    expect(ev).toEqual({ kind: "progress", pct: 37.5, message: "point arm=audio c=8 done (3/8)" });
  });
  it("ignores other lines", () => {
    expect(parseProgress("Mean AUDIO_RTF: 0.19")).toBeNull();
  });
});
