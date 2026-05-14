import type { ToolName } from "@modeldoctor/tool-adapters";
import type { ConfigService } from "@nestjs/config";
import type { Env } from "../../../config/env.schema.js";

const TOOL_TO_IMAGE_ENV: Record<ToolName, keyof Env> = {
  guidellm: "RUNNER_IMAGE_GUIDELLM",
  vegeta: "RUNNER_IMAGE_VEGETA",
  "prefix-cache-probe": "RUNNER_IMAGE_PREFIX_CACHE_PROBE",
  evalscope: "RUNNER_IMAGE_EVALSCOPE",
  aiperf: "RUNNER_IMAGE_AIPERF",
};

/**
 * Resolves the container image to use for a given tool. The image tag is
 * driven by `RUNNER_IMAGE_{tool}` env vars (set by the operator after
 * `./tools/build-runner-images.sh`); env-schema validation enforces each
 * tool's image env var is present outside `NODE_ENV=test`, so missing
 * here only happens if a test forgets to seed the mock — surface loudly
 * instead of silently launching a Job with no image.
 */
export function imageForTool(tool: ToolName, config: ConfigService<Env, true>): string {
  const key = TOOL_TO_IMAGE_ENV[tool];
  const v = config.get(key, { infer: true }) as string | undefined;
  if (!v) {
    throw new Error(
      `Missing image config for tool '${tool}': set the ${String(key)} environment variable.`,
    );
  }
  return v;
}
