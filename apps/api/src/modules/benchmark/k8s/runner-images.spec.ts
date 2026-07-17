import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import type { Env } from "../../../config/env.schema.js";
import { imageForTool } from "./runner-images.js";

const IMAGES: Record<string, string> = {
  RUNNER_IMAGE_GUIDELLM: "md-runner-guidellm:test",
  RUNNER_IMAGE_VEGETA: "md-runner-vegeta:test",
  RUNNER_IMAGE_EVALSCOPE: "md-runner-evalscope:test",
  RUNNER_IMAGE_AIPERF: "md-runner-aiperf:test",
  RUNNER_IMAGE_TAU3: "md-runner-tau3:test",
  RUNNER_IMAGE_VLLM_OMNI_BENCH: "md-runner-vllm-omni-bench:test",
};

function makeConfig(overrides: Record<string, string | undefined> = {}) {
  const values = { ...IMAGES, ...overrides };
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService<Env, true>;
}

describe("imageForTool", () => {
  it.each([
    ["guidellm", "md-runner-guidellm:test"],
    ["vegeta", "md-runner-vegeta:test"],
    ["evalscope", "md-runner-evalscope:test"],
    ["aiperf", "md-runner-aiperf:test"],
    ["tau3", "md-runner-tau3:test"],
    ["vllm-omni-bench", "md-runner-vllm-omni-bench:test"],
  ] as const)("resolves %s -> %s", (tool, expected) => {
    expect(imageForTool(tool, makeConfig())).toBe(expected);
  });

  it("throws a descriptive error when the tau3 image env var is unset", () => {
    const config = makeConfig({ RUNNER_IMAGE_TAU3: undefined });
    expect(() => imageForTool("tau3", config)).toThrow(/RUNNER_IMAGE_TAU3/);
  });
});
