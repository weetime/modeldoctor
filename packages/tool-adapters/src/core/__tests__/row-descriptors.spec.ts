import { describe, expect, it } from "vitest";
import { aiperfRowDescriptors } from "../../aiperf/row-descriptors.js";
import { evalscopeRowDescriptors } from "../../evalscope/row-descriptors.js";
import { guidellmRowDescriptors } from "../../guidellm/row-descriptors.js";
import { vegetaRowDescriptors } from "../../vegeta/row-descriptors.js";
import { SHARED_INFERENCE_ROWS } from "../row-descriptor.js";
import { rowDescriptorsByTool } from "../row-descriptors.fe.js";

describe("rowDescriptorsByTool", () => {
  it("covers exactly the 4 known tools", () => {
    expect(Object.keys(rowDescriptorsByTool).sort()).toEqual([
      "aiperf",
      "evalscope",
      "guidellm",
      "vegeta",
    ]);
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
