import { describe, expect, it } from "vitest";
import { aiperfRowDescriptors } from "../../aiperf/row-descriptors.js";
import { evalscopeRowDescriptors } from "../../evalscope/row-descriptors.js";
import { guidellmRowDescriptors } from "../../guidellm/row-descriptors.js";
import { tau3RowDescriptors } from "../../tau3/row-descriptors.js";
import { vegetaRowDescriptors } from "../../vegeta/row-descriptors.js";
import { vllmOmniBenchRowDescriptors } from "../../vllm-omni-bench/row-descriptors.js";
import { SHARED_INFERENCE_ROWS } from "../row-descriptor.js";
import { rowDescriptorsByTool } from "../row-descriptors.fe.js";

describe("rowDescriptorsByTool", () => {
  it("covers exactly the 6 known tools", () => {
    expect(Object.keys(rowDescriptorsByTool).sort()).toEqual([
      "aiperf",
      "evalscope",
      "guidellm",
      "tau3",
      "vegeta",
      "vllm-omni-bench",
    ]);
  });

  it("tau3 (agent scenario) has no compare-grid rows — not inference-shaped", () => {
    expect(tau3RowDescriptors).toEqual([]);
  });

  it("guidellm + evalscope + aiperf share SHARED_INFERENCE_ROWS by identity", () => {
    expect(guidellmRowDescriptors).toBe(SHARED_INFERENCE_ROWS);
    expect(evalscopeRowDescriptors).toBe(SHARED_INFERENCE_ROWS);
    expect(aiperfRowDescriptors).toBe(SHARED_INFERENCE_ROWS);
  });

  it("vegeta uses its own row set (no ttft/itl)", () => {
    expect(vegetaRowDescriptors).not.toBe(SHARED_INFERENCE_ROWS);
    expect(vegetaRowDescriptors.find((r) => r.labelKey.startsWith("ttft"))).toBeUndefined();
    expect(vegetaRowDescriptors.find((r) => r.labelKey.startsWith("itl"))).toBeUndefined();
  });

  it("vllm-omni-bench uses its own row set (voice-realtime metrics, not inference-shaped)", () => {
    expect(vllmOmniBenchRowDescriptors).not.toBe(SHARED_INFERENCE_ROWS);
    expect(vllmOmniBenchRowDescriptors.length).toBeGreaterThan(0);
    expect(vllmOmniBenchRowDescriptors.find((r) => r.labelKey === "realtimeCeiling")).toBeDefined();
  });

  it("every spec is well-formed (metric or raw branch)", () => {
    for (const [, specs] of Object.entries(rowDescriptorsByTool)) {
      for (const spec of specs) {
        if (spec.source === "metric") {
          expect(typeof spec.metric).toBe("string");
        } else {
          expect(typeof spec.section).toBe("string");
          expect(typeof spec.field).toBe("string");
        }
        expect(typeof spec.labelKey).toBe("string");
      }
    }
  });
});
