import { z } from "zod";
import type { ToolName } from "./core/interface.js";
import { allAdapters, byTool } from "./core/registry.js";

export type ScenarioId =
  | "inference"
  | "capacity"
  | "gateway"
  | "prefix-cache-validation"
  | "kv-cache-stress";

export const scenarioIdSchema = z.enum([
  "inference",
  "capacity",
  "gateway",
  "prefix-cache-validation",
  "kv-cache-stress",
]);

export interface ScenarioConfig {
  readonly label: string;
  readonly description: string;
  readonly tools: readonly ToolName[];
  readonly paramsConstraints: Partial<Record<ToolName, z.ZodRawShape>>;
  readonly reportComponent:
    | "InferenceReport"
    | "CapacityReport"
    | "GatewayReport"
    | "PrefixCacheProbeReport"
    | "KvCacheStressReport";
}

export const SCENARIOS: Record<ScenarioId, ScenarioConfig> = {
  inference: {
    label: "推理性能基准",
    description: "TTFT / TPOT / 单次吞吐基线",
    tools: ["guidellm", "genai-perf", "evalscope", "aiperf"],
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
  "prefix-cache-validation": {
    label: "Prefix-cache 路由验证",
    description:
      "验证 Higress ai-load-balancer prefix-cache 策略下相同前缀请求是否粘到同一 vLLM 副本",
    tools: ["prefix-cache-probe"],
    paramsConstraints: {},
    reportComponent: "PrefixCacheProbeReport",
  },
  "kv-cache-stress": {
    label: "KV cache 后端压测",
    description:
      "长 prompt 冷/暖双轮 evalscope perf,对比不同 KV 卸载后端 (vanilla / LMCache / YRCache) 的 TTFT / 吞吐 / prefix-cache 命中率",
    tools: ["kv-cache-stress", "evalscope"],
    paramsConstraints: {},
    reportComponent: "KvCacheStressReport",
  },
};

/**
 * Unwrap a possibly-`ZodEffects`-wrapped schema down to its inner `ZodObject`.
 *
 * The guidellm `paramsSchema` is a `ZodObject.superRefine(...)` (i.e.
 * `ZodEffects<ZodObject>`), so we cannot call `.merge(...)` on it directly.
 * `merge()` is only defined on `ZodObject`. We unwrap recursively in case
 * future schemas chain multiple effects.
 *
 * IMPORTANT — refinement is dropped:
 * Unwrapping discards every `superRefine` / `refine` chained onto the inner
 * `ZodObject`. The returned schema validates field shapes only; cross-field
 * rules (e.g. guidellm's "random dataset requires datasetInputTokens and
 * datasetOutputTokens") are NOT enforced on the unwrapped result.
 *
 * Callers that need full validation MUST also parse the input through the
 * original (non-unwrapped) `adapter.paramsSchema`. See the matching warning
 * on `applyScenarioConstraints` and the regression test in
 * `scenarios.spec.ts`.
 */
function unwrapToZodObject(schema: z.ZodTypeAny): z.AnyZodObject {
  let cur: z.ZodTypeAny = schema;
  // ZodEffects has _def.schema pointing at the inner schema.
  while (cur instanceof z.ZodEffects) {
    cur = cur._def.schema;
  }
  return cur as z.AnyZodObject;
}

/**
 * Return a `ZodObject` that layers scenario-specific narrowing (e.g.
 * `rateType=sweep` for capacity) on top of the adapter's base param shape.
 *
 * IMPORTANT — refinement is dropped:
 * The returned schema is built by unwrapping the adapter's `paramsSchema`
 * (see `unwrapToZodObject`) and `.merge(...)`-ing the constraint shape onto
 * it. Any `superRefine` / `refine` chained onto the original
 * `adapter.paramsSchema` is **lost** in this process — most notably
 * guidellm's cross-field check that "random dataset requires
 * `datasetInputTokens` and `datasetOutputTokens`".
 *
 * Callers that need full validation (the typical caller is
 * `BenchmarkService.create` in Phase 5) MUST also run
 * `adapter.paramsSchema.parse(input)` against the ORIGINAL, non-merged
 * schema. Treat the schema returned here as "shape + scenario narrowing
 * only", not as a complete validator.
 *
 * The drop is pinned by a regression test in `scenarios.spec.ts`; if you
 * change this function to preserve the refinement, that contract change
 * must propagate into Phase 5 (BenchmarkService) as well.
 */
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
