import { describe, expect, it } from "vitest";
import type { RunExecutionContext } from "./execution-driver.interface.js";
import { buildJobManifest, buildSecretManifest, jobName, secretName } from "./k8s-job-manifest.js";

const ctx: RunExecutionContext = {
  runId: "abc123",
  tool: "guidellm",
  buildResult: {
    argv: ["guidellm", "benchmark", "run", "--target=http://x"],
    env: { FOO: "bar", BAZ: "qux" },
    secretEnv: { API_KEY: "secret-value" },
    inputFiles: { "targets.txt": "POST http://x" },
    outputFiles: { report: "report.json" },
  },
  callback: { url: "http://api/", token: "tk" },
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
  it("references the per-run Secret via envFrom", () => {
    const j = buildJobManifest(ctx, { namespace: "ns" });
    expect(j.metadata?.name).toBe("run-abc123");
    const c = j.spec?.template.spec?.containers[0];
    expect(c?.image).toBe("ghcr.io/example/runner:latest");
    expect(c?.envFrom).toContainEqual({ secretRef: { name: "run-abc123" } });
  });

  it("ships non-secret env values directly + MD_* control vars", () => {
    const j = buildJobManifest(ctx, { namespace: "ns" });
    const env = j.spec?.template.spec?.containers[0].env ?? [];
    expect(env).toContainEqual({ name: "FOO", value: "bar" });
    expect(env).toContainEqual({ name: "BAZ", value: "qux" });
    expect(env).toContainEqual({ name: "MD_RUN_ID", value: "abc123" });
    expect(env).toContainEqual({ name: "MD_CALLBACK_URL", value: "http://api/" });
    expect(env).toContainEqual({ name: "MD_ARGV", value: JSON.stringify(ctx.buildResult.argv) });
    expect(env).toContainEqual({
      name: "MD_OUTPUT_FILES",
      value: JSON.stringify(ctx.buildResult.outputFiles),
    });
  });

  it("does NOT put callback token in env value (must come from Secret via envFrom)", () => {
    const j = buildJobManifest(ctx, { namespace: "ns" });
    const env = j.spec?.template.spec?.containers[0].env ?? [];
    const tokenEntry = env.find((e) => e.name === "MD_CALLBACK_TOKEN");
    expect(tokenEntry).toBeUndefined();

    const s = buildSecretManifest(ctx, "ns");
    expect(s.stringData?.MD_CALLBACK_TOKEN).toBe("tk");
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

describe("naming helpers", () => {
  it("jobName is run-<id>", () => {
    expect(jobName("xyz")).toBe("run-xyz");
  });
  it("secretName matches jobName for ownerRef GC", () => {
    expect(secretName("xyz")).toBe(jobName("xyz"));
  });
});
