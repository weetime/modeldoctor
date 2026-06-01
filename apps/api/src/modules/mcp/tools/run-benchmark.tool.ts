// apps/api/src/modules/mcp/tools/run-benchmark.tool.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createBenchmarkRequestSchema } from "@modeldoctor/contracts";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

// Tool input = the REST create contract + an optional confirmToken. The
// request bound into the token is the create contract WITHOUT confirmToken.
type RunBenchmarkInput = z.infer<typeof createBenchmarkRequestSchema> & {
  confirmToken?: string;
};

export function registerRunBenchmark(server: McpServer, deps: McpToolDeps): void {
  registerTool<RunBenchmarkInput>(
    server,
    {
      name: "run_benchmark",
      title: "Run a benchmark (dry-run + confirm)",
      description:
        "Start a benchmark run. TWO-STEP: call once WITHOUT confirmToken to get a plan " +
        "(resolved params + a confirmToken); call again WITH that confirmToken and the " +
        "SAME params to actually create the run (this dispatches a Kubernetes Job and " +
        "consumes GPU). Poll status with get_benchmark. Token binds the exact params and " +
        "expires in 10 minutes.",
      inputShape: {
        scenario: z
          .string()
          .describe("inference | capacity | gateway | prefix-cache-validation | kv-cache-stress"),
        tool: z.string().describe("guidellm | vegeta | prefix-cache-probe | evalscope | aiperf"),
        connectionId: z.string().min(1).describe("Target connection id."),
        name: z.string().min(1).max(128).describe("Run name."),
        description: z.string().max(2048).optional().describe("Optional run description."),
        params: z
          .record(z.unknown())
          .describe("Tool/scenario params (see a template or the web create form)."),
        templateId: z.string().optional(),
        parentBenchmarkId: z.string().optional().describe("Benchmark to branch from."),
        baselineId: z.string().optional(),
        confirmToken: z.string().optional().describe("Omit for dry-run; supply to execute."),
      },
    },
    async (input) => {
      const { confirmToken, ...rest } = input;
      // Validate/normalize against the REST contract so the bound request and
      // the executed request are identical and contract-valid.
      const req = createBenchmarkRequestSchema.parse(rest);

      if (!confirmToken) {
        const token = deps.confirmTokens.issue("run_benchmark", req);
        const plan = {
          dryRun: true,
          willCreate: "benchmark (Kubernetes Job, consumes GPU)",
          target: { connectionId: req.connectionId, scenario: req.scenario, tool: req.tool },
          request: req,
          confirmToken: token,
          note: "Re-call run_benchmark with the SAME params plus this confirmToken to execute.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(plan, null, 2) }],
          structuredContent: plan as unknown as Record<string, unknown>,
        };
      }

      const verdict = deps.confirmTokens.verify("run_benchmark", req, confirmToken);
      if (!verdict.ok) {
        return {
          content: [
            {
              type: "text",
              text: `confirmToken invalid (${verdict.reason}). Re-run the dry-run to get a fresh token; params must match exactly.`,
            },
          ],
          isError: true,
        };
      }
      // create() dispatches a K8s Job and can throw (incompatible scenario/tool,
      // bad params, name conflict, dispatch failure); surface it as readable
      // isError text rather than an opaque RPC fault.
      try {
        const created = await deps.benchmarks.create(deps.userId, req);
        return {
          content: [{ type: "text", text: JSON.stringify(created, null, 2) }],
          structuredContent: created as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [
            { type: "text", text: `run_benchmark execution failed: ${(e as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  );
}
