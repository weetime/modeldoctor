// apps/api/src/modules/mcp/tools/run-quality-gate.tool.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createRunRequestSchema } from "@modeldoctor/contracts";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type RunQualityGateInput = z.infer<typeof createRunRequestSchema> & { confirmToken?: string };

export function registerRunQualityGate(server: McpServer, deps: McpToolDeps): void {
  registerTool<RunQualityGateInput>(
    server,
    {
      name: "run_quality_gate",
      title: "Run a quality-gate evaluation (dry-run + confirm)",
      description:
        "Start a quality-gate run for an evaluation against endpoint A (and optional B). " +
        "TWO-STEP: call WITHOUT confirmToken to get a plan + confirmToken; call again WITH " +
        "the token and SAME params to execute (runs samples through judges). Poll with " +
        "get_quality_gate_run. genConfig (thinking/maxTokens/temperature) and gateConfig " +
        "(passRateMin) follow the REST contract.",
      inputShape: {
        evaluationId: z.string().min(1).describe("Evaluation id to run."),
        endpointAId: z.string().min(1).describe("Primary endpoint connection id (A)."),
        endpointBId: z.string().optional().describe("Optional comparison endpoint (B)."),
        baselineRunIdOverride: z.string().nullable().optional(),
        gateConfig: z
          .object({
            passRateMin: z.number().min(0).max(1).optional(),
            regressionMax: z.number().int().nonnegative().optional(),
            judgeScoreMin: z.number().min(0).max(5).optional(),
          })
          .describe("Gate thresholds."),
        genConfig: z
          .object({
            maxTokens: z.number().int().min(1).max(32768).optional(),
            temperature: z.number().min(0).max(2).optional(),
            thinking: z.enum(["auto", "on", "off"]).optional(),
            stop: z.array(z.string().min(1).max(64)).max(4).optional(),
          })
          .partial()
          .optional()
          .describe("Per-run generation params (override the eval defaults)."),
        confirmToken: z.string().optional().describe("Omit for dry-run; supply to execute."),
      },
    },
    async (input) => {
      const { confirmToken, ...rest } = input;
      const req = createRunRequestSchema.parse(rest);

      if (!confirmToken) {
        const token = deps.confirmTokens.issue("run_quality_gate", req);
        const plan = {
          dryRun: true,
          willCreate: "quality-gate run (issues model calls + judging)",
          target: { evaluationId: req.evaluationId, endpointAId: req.endpointAId, endpointBId: req.endpointBId },
          request: req,
          confirmToken: token,
          note: "Re-call run_quality_gate with the SAME params plus this confirmToken to execute.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(plan, null, 2) }],
          structuredContent: plan as unknown as Record<string, unknown>,
        };
      }

      const verdict = deps.confirmTokens.verify("run_quality_gate", req, confirmToken);
      if (!verdict.ok) {
        return {
          content: [
            {
              type: "text",
              text: `confirmToken invalid (${verdict.reason}). Re-run the dry-run for a fresh token; params must match exactly.`,
            },
          ],
          isError: true,
        };
      }
      // create() dispatches model calls + judging and can throw (bad eval id,
      // connection unreachable, quota exceeded, etc.); surface it as readable
      // isError text rather than an opaque RPC fault.
      try {
        const created = await deps.runs.create(deps.userId, req);
        return {
          content: [{ type: "text", text: JSON.stringify(created, null, 2) }],
          structuredContent: created as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `run_quality_gate execution failed: ${(e as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
