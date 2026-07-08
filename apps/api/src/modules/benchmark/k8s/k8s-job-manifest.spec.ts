import { describe, expect, it } from "vitest";
import type { BenchmarkRunInput } from "./k8s-benchmark-runner.js";
import { buildJobManifest, buildSecretManifest, jobName, secretName } from "./k8s-job-manifest.js";

const ctx: BenchmarkRunInput = {
  runId: "abc123",
  tool: "guidellm",
  buildResult: {
    argv: ["guidellm", "benchmark", "run", "--target=http://x"],
    env: { FOO: "bar", BAZ: "qux" },
    secretEnv: { API_KEY: "secret-value" },
    inputFiles: { "targets.txt": "POST http://x" },
    outputFiles: { report: "report.json" },
  },
  image: "ghcr.io/example/runner:latest",
};

describe("buildSecretManifest", () => {
  it("includes secretEnv and inputFiles in stringData", () => {
    const s = buildSecretManifest(ctx, "ns");
    expect(s.metadata?.name).toBe("run-abc123");
    expect(s.stringData?.API_KEY).toBe("secret-value");
    // inputFiles entries are prefixed with INPUT_FILE_<base64alias> to keep the
    // Secret key flat (Secret keys must be DNS-segment-like).
    const inputFileKeys = Object.keys(s.stringData ?? {}).filter((k) =>
      k.startsWith("INPUT_FILE_"),
    );
    expect(inputFileKeys).toHaveLength(1);
    expect(s.stringData?.[inputFileKeys[0]]).toBe("POST http://x");
  });
});

describe("buildJobManifest", () => {
  it("references the per-run Secret and storage Secret via envFrom", () => {
    const j = buildJobManifest(ctx, { namespace: "ns" });
    expect(j.metadata?.name).toBe("run-abc123");
    const c = j.spec?.template.spec?.containers[0];
    expect(c?.image).toBe("ghcr.io/example/runner:latest");
    expect(c?.envFrom).toEqual([
      { secretRef: { name: "run-abc123" } },
      { secretRef: { name: "md-benchmark-storage" } },
    ]);
  });

  it("envFrom includes md-benchmark-storage Secret", () => {
    const j = buildJobManifest(ctx, { namespace: "ns" });
    const c = j.spec?.template.spec?.containers[0];
    expect(c?.envFrom).toContainEqual(
      expect.objectContaining({
        secretRef: expect.objectContaining({ name: "md-benchmark-storage" }),
      }),
    );
  });

  it("ships non-secret env values directly + MD_* control vars", () => {
    const j = buildJobManifest(ctx, { namespace: "ns" });
    const env = j.spec?.template.spec?.containers[0].env ?? [];
    expect(env).toContainEqual({ name: "FOO", value: "bar" });
    expect(env).toContainEqual({ name: "BAZ", value: "qux" });
    expect(env).toContainEqual({ name: "MD_BENCHMARK_ID", value: "abc123" });
    expect(env).toContainEqual({ name: "MD_ARGV", value: JSON.stringify(ctx.buildResult.argv) });
    expect(env).toContainEqual({
      name: "MD_OUTPUT_FILES",
      value: JSON.stringify(ctx.buildResult.outputFiles),
    });
  });

  it("mounts inputFiles via volume sourced from the Secret", () => {
    const j = buildJobManifest(ctx, { namespace: "ns" });
    const c = j.spec?.template.spec?.containers[0];
    const mount = c?.volumeMounts?.find((m) => m.name === "input-files");
    expect(mount).toBeDefined();
    expect(mount?.mountPath).toBe("/workdir/inputs");
    const vol = j.spec?.template.spec?.volumes?.find((v) => v.name === "input-files");
    expect(vol?.secret?.secretName).toBe("run-abc123");
    // The wrapper symlinks /workdir/inputs/<base64alias> → cwd/<relpath> at startup.
  });
});

describe("buildJobManifest HF tokenizer env (#339)", () => {
  function hfEnv(hf: { endpoint?: string; token?: string; offline?: boolean } | undefined) {
    const j = buildJobManifest(ctx, { namespace: "ns", hf });
    const env = j.spec?.template.spec?.containers[0].env ?? [];
    return (name: string) => env.find((e) => e.name === name);
  }

  it("injects no HF_* env when hf is absent", () => {
    const get = hfEnv(undefined);
    expect(get("HF_ENDPOINT")).toBeUndefined();
    expect(get("HF_TOKEN")).toBeUndefined();
    expect(get("HF_HUB_OFFLINE")).toBeUndefined();
  });

  it("injects HF_ENDPOINT with the trailing slash stripped", () => {
    const get = hfEnv({ endpoint: "https://hf-mirror.com/" });
    expect(get("HF_ENDPOINT")).toEqual({ name: "HF_ENDPOINT", value: "https://hf-mirror.com" });
  });

  it("injects HF_TOKEN when set", () => {
    const get = hfEnv({ token: "hf_secret" });
    expect(get("HF_TOKEN")).toEqual({ name: "HF_TOKEN", value: "hf_secret" });
  });

  it("injects HF_HUB_OFFLINE=1 only when offline is true", () => {
    expect(hfEnv({ offline: true })("HF_HUB_OFFLINE")).toEqual({
      name: "HF_HUB_OFFLINE",
      value: "1",
    });
    expect(hfEnv({ offline: false })("HF_HUB_OFFLINE")).toBeUndefined();
  });
});

describe("buildJobManifest checkpoint env (resume)", () => {
  function envOf(j: ReturnType<typeof buildJobManifest>) {
    const env = j.spec?.template.spec?.containers[0].env ?? [];
    return Object.fromEntries(env.map((x) => [x.name, x.value]));
  }

  it("injects checkpoint env when opts.checkpointDir set", () => {
    const j = buildJobManifest(ctx, {
      namespace: "ns",
      checkpointDir: "data/simulations",
      checkpointIntervalSec: 60,
    });
    const env = envOf(j);
    expect(env.MD_CHECKPOINT_DIR).toBe("data/simulations");
    expect(env.MD_CHECKPOINT_INTERVAL_SEC).toBe("60");
    expect(env.MD_RESUME).toBeUndefined();
  });

  it("adds MD_RESUME=1 only when ctx.resume", () => {
    const j = buildJobManifest(
      { ...ctx, resume: true },
      { namespace: "ns", checkpointDir: "data/simulations" },
    );
    expect(envOf(j).MD_RESUME).toBe("1");
  });

  it("no checkpoint env when checkpointDir absent (non-resumable tool unchanged)", () => {
    const env = envOf(buildJobManifest(ctx, { namespace: "ns" }));
    expect(env.MD_CHECKPOINT_DIR).toBeUndefined();
    expect(env.MD_CHECKPOINT_INTERVAL_SEC).toBeUndefined();
    expect(env.MD_RESUME).toBeUndefined();
  });
});

describe("naming helpers", () => {
  it("jobName is run-<id>", () => {
    expect(jobName("xyz")).toBe("run-xyz");
  });
  it("secretName matches jobName for ownerRef GC", () => {
    expect(secretName("xyz")).toBe(jobName("xyz"));
  });
});
