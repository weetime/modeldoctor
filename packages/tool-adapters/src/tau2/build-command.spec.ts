import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTau2Command, tau2MaxDurationSeconds } from "./build-command.js";
import { tau2ParamDefaults } from "./schema.js";

const plan = {
  runId: "run123",
  params: { ...tau2ParamDefaults, domains: ["airline", "retail"], numTasksPerDomain: 5, numTrials: 2 },
  connection: { baseUrl: "http://agent.svc/v1", apiKey: "sk-agent", model: "qwen3-8b",
    customHeaders: "", queryParams: "", tokenizerHfId: null, prometheusDatasource: null },
  userSimulator: { baseUrl: "http://judge.svc/v1", model: "deepseek-v3", apiKey: "sk-user" },
} as const;

describe("buildTau2Command", () => {
  const r = buildTau2Command(plan as any);
  it("shells out via /bin/sh -c", () => {
    expect(r.argv[0]).toBe("/bin/sh");
    expect(r.argv[1]).toBe("-c");
  });
  it("runs tau2 once per domain with openai/ prefix + num flags", () => {
    const s = r.argv[2];
    expect(s).toContain("--domain airline");
    expect(s).toContain("--domain retail");
    expect(s).toContain("--agent-llm 'openai/qwen3-8b'");
    expect(s).toContain("--user-llm 'openai/deepseek-v3'");
    expect(s).toContain("--num-tasks 5");
    expect(s).toContain("--num-trials 2");
    expect(s).toContain("--auto-resume");
  });
  it("puts api_base in llm-args and keys only as named-secret sentinels", () => {
    const s = r.argv[2];
    expect(s).toContain('"api_base":"http://agent.svc/v1"');
    expect(s).toContain('"api_base":"http://judge.svc/v1"');
    expect(s).toContain("__MD_SECRET_MD_AGENT_KEY__");
    expect(s).toContain("__MD_SECRET_MD_USER_KEY__");
    expect(s).not.toContain("sk-agent");
    expect(s).not.toContain("sk-user");
  });
  it("passes keys via secretEnv, never argv", () => {
    expect(r.secretEnv.MD_AGENT_KEY).toBe("sk-agent");
    expect(r.secretEnv.MD_USER_KEY).toBe("sk-user");
  });
  it("calls the summarizer with runId + domains", () => {
    expect(r.argv[2]).toContain("md_tau2_summarize.py");
    expect(r.argv[2]).toContain("--run-id run123");
    expect(r.argv[2]).toContain("--domains airline,retail");
  });
  it("declares summary + per-domain results output files", () => {
    expect(r.outputFiles.summary).toBe("md_out/summary.json");
    expect(r.outputFiles.results_airline).toBe("data/simulations/run123_airline/results.json");
    expect(r.outputFiles.results_retail).toBe("data/simulations/run123_retail/results.json");
  });
});

describe("buildTau2Command shell injection safety", () => {
  it("shell-escapes a malicious model so it cannot break out of /bin/sh -c", () => {
    // NB: the raw payload text can still appear as a substring of the quoted
    // output (e.g. "; touch ..." sits harmlessly inside '...'); a substring
    // assertion alone doesn't prove safety. Prove it for real: execute the
    // generated /bin/sh -c script and confirm the injected command never runs.
    const marker = join(tmpdir(), `md_tau2_shq_pwn_${Date.now()}_${process.pid}`);
    const evil = {
      ...plan,
      connection: { ...plan.connection, model: `m'; touch ${marker}; echo '` },
    } as any;
    const r = buildTau2Command(evil);
    const s = r.argv[2];
    expect(s).toContain("'\\''"); // single quote was escaped
    try {
      // tau2/python aren't installed in the test env; command-not-found exits
      // non-zero, which is expected and irrelevant to injection safety.
      execFileSync(r.argv[0], [r.argv[1], s], { stdio: "ignore" });
    } catch {
      // ignore non-zero exit from missing tau2/python binaries
    }
    expect(existsSync(marker)).toBe(false); // injected command never executed
  });
});

describe("tau2MaxDurationSeconds", () => {
  it("scales with domains × tasks × trials", () => {
    const full = tau2MaxDurationSeconds({ ...tau2ParamDefaults, domains: ["airline","retail","telecom"], numTasksPerDomain: null, numTrials: 4 });
    const smoke = tau2MaxDurationSeconds({ ...tau2ParamDefaults, domains: ["airline"], numTasksPerDomain: 5, numTrials: 1 });
    expect(full).toBeGreaterThan(smoke);
    expect(smoke).toBeGreaterThan(0);
  });
});
