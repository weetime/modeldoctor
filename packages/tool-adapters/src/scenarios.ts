import { z } from "zod";
import type { ToolName } from "./core/interface.js";
import { allAdapters, byTool } from "./core/registry.js";

export type ScenarioId = "inference" | "capacity" | "gateway";

export const scenarioIdSchema = z.enum(["inference", "capacity", "gateway"]);

export interface ScenarioConfig {
  readonly label: string;
  readonly description: string;
  readonly tools: readonly ToolName[];
  readonly paramsConstraints: Partial<Record<ToolName, z.ZodRawShape>>;
  readonly reportComponent: "InferenceReport" | "CapacityReport" | "GatewayReport";
}

export const SCENARIOS: Record<ScenarioId, ScenarioConfig> = {
  inference: {
    label: "推理性能基准",
    description: "TTFT / TPOT / 单次吞吐基线",
    tools: ["guidellm", "genai-perf"],
    paramsConstraints: {
      guidellm: {
        rateType: z.enum(["constant", "poisson", "throughput", "synchronous"]),
      },
    },
    reportComponent: "InferenceReport",
  },
  capacity: {
    label: "容量规划",
    description: "SLO 驱动的负载阶梯扫描",
    tools: ["guidellm"],
    paramsConstraints: {
      guidellm: {
        rateType: z.literal("sweep"),
      },
    },
    reportComponent: "CapacityReport",
  },
  gateway: {
    label: "网关压测",
    description: "Higress / API 链路 HTTP 性能",
    tools: ["vegeta"],
    paramsConstraints: {},
    reportComponent: "GatewayReport",
  },
};

/**
 * Unwrap a possibly-`ZodEffects`-wrapped schema down to its inner `ZodObject`.
 *
 * The guidellm `paramsSchema` is a `ZodObject.superRefine(...)` (i.e.
 * `ZodEffects<ZodObject>`), so we cannot call `.merge(...)` on it directly.
 * `merge()` is only defined on `ZodObject`. We unwrap recursively in case
 * future schemas chain multiple effects.
 */
function unwrapToZodObject(schema: z.ZodTypeAny): z.AnyZodObject {
  let cur: z.ZodTypeAny = schema;
  // ZodEffects has _def.schema pointing at the inner schema.
  while (cur instanceof z.ZodEffects) {
    cur = cur._def.schema;
  }
  return cur as z.AnyZodObject;
}

export function applyScenarioConstraints(scenario: ScenarioId, tool: ToolName): z.AnyZodObject {
  const cfg = SCENARIOS[scenario];
  if (!cfg.tools.includes(tool)) {
    throw new Error(`scenario '${scenario}' does not support tool '${tool}'`);
  }
  const adapter = byTool(tool);
  const baseSchema = unwrapToZodObject(adapter.paramsSchema);
  const constraint = cfg.paramsConstraints[tool];
  if (!constraint || Object.keys(constraint).length === 0) return baseSchema;
  return baseSchema.merge(z.object(constraint));
}

export function assertScenariosInvariant(): void {
  for (const [scenarioId, cfg] of Object.entries(SCENARIOS)) {
    for (const tool of cfg.tools) {
      const adapter = byTool(tool);
      if (!adapter.scenarios.includes(scenarioId as ScenarioId)) {
        throw new Error(
          `invariant: SCENARIOS['${scenarioId}'].tools includes '${tool}', but ` +
            `'${tool}'.scenarios = [${adapter.scenarios.join(",")}] does not include '${scenarioId}'`,
        );
      }
    }
  }
  for (const adapter of allAdapters()) {
    for (const scenarioId of adapter.scenarios) {
      if (!SCENARIOS[scenarioId].tools.includes(adapter.name)) {
        throw new Error(
          `invariant: '${adapter.name}'.scenarios includes '${scenarioId}', but ` +
            `SCENARIOS['${scenarioId}'].tools = [${SCENARIOS[scenarioId].tools.join(",")}] ` +
            `does not include '${adapter.name}'`,
        );
      }
    }
  }
}
