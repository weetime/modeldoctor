import type { BuildCommandPlan, BuildCommandResult, ProgressEvent } from "../core/interface.js";
import { tau2ParamsSchema, type Tau2Domain, type Tau2Params } from "./schema.js";

// Full task-set sizes (from tau2 source data/tau2/domains). Used only for
// duration estimation when numTasksPerDomain is null (full set).
const FULL_TASK_COUNT: Record<Tau2Domain, number> = { airline: 50, retail: 114, telecom: 114 };
const SECONDS_PER_EPISODE = 90; // generous per multi-turn episode upper bound

function llmArgs(apiBase: string, keyEnvName: string): string {
  // JSON dict passed to tau2 --*-llm-args (json.loads). api_key is a named-
  // secret sentinel; runner swaps in os.environ[keyEnvName] before spawn.
  return JSON.stringify({ api_base: apiBase, api_key: `__MD_SECRET_${keyEnvName}__`, temperature: 0.0 });
}

// Safely single-quote a value for inclusion in a /bin/sh -c script:
// wrap in single quotes and escape any embedded single quote as '\'' .
function shq(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export function buildTau2Command(plan: BuildCommandPlan<Tau2Params>): BuildCommandResult {
  const params = tau2ParamsSchema.parse(plan.params) as Tau2Params;
  const { runId, connection, userSimulator } = plan;
  if (!userSimulator) throw new Error("tau2 requires a resolved userSimulator endpoint");

  const agentArgs = llmArgs(connection.baseUrl, "MD_AGENT_KEY");
  const userArgs = llmArgs(userSimulator.baseUrl, "MD_USER_KEY");
  const numTasksFlag = params.numTasksPerDomain != null ? ` --num-tasks ${params.numTasksPerDomain}` : "";

  const perDomain = params.domains.map((d) => {
    // shq() neutralizes any single quote in the interpolated value, so this
    // is safe even if agentArgs/userArgs (built from user-controlled
    // baseUrl) or connection.model/userSimulator.model contain a quote.
    // --domain / --num-trials / --max-steps / --max-concurrency / --save-to
    // are left unquoted: `d` is enum-validated and `runId` is a
    // Prisma-generated id; only unrestricted model/baseUrl need escaping.
    return [
      "tau2 run",
      `--domain ${d}`,
      `--agent-llm ${shq("openai/" + connection.model)}`,
      `--agent-llm-args ${shq(agentArgs)}`,
      `--user-llm ${shq("openai/" + userSimulator.model)}`,
      `--user-llm-args ${shq(userArgs)}`,
      `--num-trials ${params.numTrials}`,
      numTasksFlag.trim(),
      `--max-steps ${params.maxSteps}`,
      `--max-concurrency ${params.maxConcurrency}`,
      `--save-to ${runId}_${d}`,
      "--auto-resume",
    ].filter(Boolean).join(" ");
  });

  const summarize = `python /app/tau2/md_tau2_summarize.py --run-id ${runId} --domains ${params.domains.join(",")} --num-trials ${params.numTrials} --user-sim-model ${shq(userSimulator.model)} --out md_out/summary.json`;
  const script = [...perDomain, summarize].join(" && ");

  const outputFiles: Record<string, string> = { summary: "md_out/summary.json" };
  for (const d of params.domains) outputFiles[`results_${d}`] = `data/simulations/${runId}_${d}/results.json`;

  return {
    argv: ["/bin/sh", "-c", script],
    env: {},
    secretEnv: { MD_AGENT_KEY: connection.apiKey, MD_USER_KEY: userSimulator.apiKey },
    outputFiles,
  };
}

export function tau2MaxDurationSeconds(params: unknown): number {
  const p = tau2ParamsSchema.parse(params) as Tau2Params;
  const totalTasks = p.domains.reduce(
    (sum, d) => sum + (p.numTasksPerDomain ?? FULL_TASK_COUNT[d]), 0);
  return totalTasks * p.numTrials * SECONDS_PER_EPISODE;
}

export function tau2ParseProgress(line: string): ProgressEvent | null {
  // tau2 prints task progress; surface a coarse log line. A tighter percent
  // parser can be tuned in Task 13 against real stdout.
  const m = line.match(/(\d+)\s*\/\s*(\d+)\s+tasks?/i);
  if (m) {
    const [, done, total] = m;
    const pct = Math.round((Number(done) / Number(total)) * 100);
    return { kind: "progress", pct, message: `${done}/${total} tasks` };
  }
  return null;
}
