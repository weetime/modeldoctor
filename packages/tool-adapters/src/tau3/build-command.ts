import type { BuildCommandPlan, BuildCommandResult, ProgressEvent } from "../core/interface.js";
import { type Tau3Domain, type Tau3Params, tau3ParamsSchema } from "./schema.js";

// Full task-set sizes (from tau2 source data/tau2/domains). Used only for
// duration estimation when numTasksPerDomain is null (full set).
const FULL_TASK_COUNT: Record<Tau3Domain, number> = { airline: 50, retail: 114, telecom: 114 };
const SECONDS_PER_EPISODE = 90; // generous per multi-turn episode upper bound

/**
 * litellm's `openai/` provider POSTs to `{api_base}/chat/completions`, so the
 * `api_base` it's handed MUST include the OpenAI `/v1` path prefix. Connection
 * baseUrls follow the app-wide convention of being the host ROOT (no `/v1` —
 * every other consumer appends the full `/v1/chat/completions` itself via
 * `buildUrl`/`DEFAULT_PATH`, see `integrations/openai-client/url.ts`). Without
 * this, litellm hits `{host}/chat/completions` → 404 and every τ³-bench
 * episode is counted as an infra error (Total Tasks 0). Idempotent: a baseUrl
 * that already ends in `/v1` is left untouched, and trailing slashes are
 * trimmed first so we never emit `//v1`.
 */
function toOpenAiV1Base(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

function llmArgs(apiBase: string, keyEnvName: string): string {
  // JSON dict passed to tau2 --*-llm-args (json.loads). api_key is a named-
  // secret sentinel; runner swaps in os.environ[keyEnvName] before spawn.
  return JSON.stringify({
    api_base: toOpenAiV1Base(apiBase),
    api_key: `__MD_SECRET_${keyEnvName}__`,
    temperature: 0.0,
  });
}

// Safely single-quote a value for inclusion in a /bin/sh -c script:
// wrap in single quotes and escape any embedded single quote as '\'' .
function shq(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * τ³-bench's reward evaluators (NL-assertion / communicate / env-interface)
 * hardcode public `gpt-4.1` / `claude-opus-4-5` in `tau2/config.py` and call
 * them with NO credentials → every task fails at scoring with "Missing
 * credentials". We route them at the workspace-default judge provider
 * (`plan.evaluator`) instead, self-hosted:
 *
 *  - a `sed` prepended to the run script rewrites those hardcoded model
 *    constants to `openai/<evaluator.model>` (patched on disk BEFORE `tau2
 *    run` imports the evaluator modules, which bind the constant as a default
 *    arg at import time), and
 *  - `OPENAI_BASE_URL` (env) + `OPENAI_API_KEY` (secretEnv) point litellm's
 *    `openai/` provider at the evaluator endpoint. The agent/user calls carry
 *    their OWN `api_base` in `--*-llm-args`, which litellm prefers over the
 *    env, so only the credential-less evaluator calls fall back to it.
 */
function evaluatorConfigPatch(evalModel: string): string {
  const ref = `openai/${evalModel}`;
  return `sed -i ${shq(`s#"gpt-4.1-2025-04-14"#"${ref}"#g;s#"claude-opus-4-5"#"${ref}"#g`)} /opt/tau2/src/tau2/config.py`;
}

export function buildTau3Command(plan: BuildCommandPlan<Tau3Params>): BuildCommandResult {
  const params = tau3ParamsSchema.parse(plan.params) as Tau3Params;
  const { runId, connection, userSimulator, evaluator } = plan;
  if (!userSimulator) throw new Error("tau3 requires a resolved userSimulator endpoint");

  const agentArgs = llmArgs(connection.baseUrl, "MD_AGENT_KEY");
  const userArgs = llmArgs(userSimulator.baseUrl, "MD_USER_KEY");
  const numTasksFlag =
    params.numTasksPerDomain != null ? ` --num-tasks ${params.numTasksPerDomain}` : "";

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
      `--agent-llm ${shq(`openai/${connection.model}`)}`,
      `--agent-llm-args ${shq(agentArgs)}`,
      `--user-llm ${shq(`openai/${userSimulator.model}`)}`,
      `--user-llm-args ${shq(userArgs)}`,
      `--num-trials ${params.numTrials}`,
      numTasksFlag.trim(),
      `--max-steps ${params.maxSteps}`,
      `--max-concurrency ${params.maxConcurrency}`,
      `--save-to ${runId}_${d}`,
      "--auto-resume",
    ]
      .filter(Boolean)
      .join(" ");
  });

  const summarize = `python /app/tau3_summarize/md_tau3_summarize.py --run-id ${runId} --domains ${params.domains.join(",")} --num-trials ${params.numTrials} --user-sim-model ${shq(userSimulator.model)} --out md_out/summary.json`;
  // Patch tau2's evaluator LLM defaults BEFORE the run (see
  // `evaluatorConfigPatch`) when an evaluator endpoint is resolved.
  const steps = evaluator
    ? [evaluatorConfigPatch(evaluator.model), ...perDomain, summarize]
    : [...perDomain, summarize];
  const script = steps.join(" && ");

  const outputFiles: Record<string, string> = { summary: "md_out/summary.json" };
  for (const d of params.domains)
    outputFiles[`results_${d}`] = `data/simulations/${runId}_${d}/results.json`;

  return {
    argv: ["/bin/sh", "-c", script],
    // The evaluator (reward-judge) calls carry no api_base of their own, so
    // point litellm's openai provider at the evaluator endpoint via env.
    env: evaluator ? { OPENAI_BASE_URL: toOpenAiV1Base(evaluator.baseUrl) } : {},
    secretEnv: {
      MD_AGENT_KEY: connection.apiKey,
      MD_USER_KEY: userSimulator.apiKey,
      ...(evaluator ? { OPENAI_API_KEY: evaluator.apiKey } : {}),
    },
    outputFiles,
  };
}

export function tau3MaxDurationSeconds(params: unknown): number {
  const p = tau3ParamsSchema.parse(params) as Tau3Params;
  const totalTasks = p.domains.reduce(
    (sum, d) => sum + (p.numTasksPerDomain ?? FULL_TASK_COUNT[d]),
    0,
  );
  return totalTasks * p.numTrials * SECONDS_PER_EPISODE;
}

export function tau3ParseProgress(line: string): ProgressEvent | null {
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
