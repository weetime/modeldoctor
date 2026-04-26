import { describe, expect, it } from "vitest";
import type { BenchmarkExecutionContext } from "./execution-driver.interface.js";
import { buildJobManifest, buildSecretManifest, jobName, secretName } from "./k8s-job-manifest.js";

const ctx: BenchmarkExecutionContext = {
  benchmarkId: "ckabc123",
  profile: "throughput",
  apiType: "chat",
  apiUrl: "https://api.example.com/v1",
  apiKey: "sk-supersecret",
  model: "llama-3-70b",
  datasetName: "random",
  datasetInputTokens: 1024,
  datasetOutputTokens: 128,
  datasetSeed: 42,
  requestRate: 0,
  totalRequests: 1000,
  maxDurationSeconds: 1800,
  callbackUrl: "http://modeldoctor-api.modeldoctor.svc:3001",
  callbackToken: "1700000000.deadbeef",
};

describe("k8s-job-manifest", () => {
  describe("naming", () => {
    it("derives stable names from benchmarkId", () => {
      expect(secretName("ckabc123")).toBe("benchmark-ckabc123");
      expect(jobName("ckabc123")).toBe("benchmark-ckabc123");
    });
  });

  describe("buildSecretManifest", () => {
    const sec = buildSecretManifest(ctx, "modeldoctor-benchmarks");

    it("targets the right namespace + name", () => {
      expect(sec.metadata?.namespace).toBe("modeldoctor-benchmarks");
      expect(sec.metadata?.name).toBe("benchmark-ckabc123");
    });

    it("uses Opaque type with stringData", () => {
      expect(sec.type).toBe("Opaque");
      expect(sec.stringData).toEqual({
        API_KEY: "sk-supersecret",
        CALLBACK_TOKEN: "1700000000.deadbeef",
      });
    });

    it("does not set ownerReferences (patched in after Job create)", () => {
      expect(sec.metadata?.ownerReferences).toBeUndefined();
    });
  });

  describe("buildJobManifest", () => {
    const job = buildJobManifest(ctx, {
      namespace: "modeldoctor-benchmarks",
      image: "modeldoctor/benchmark-runner:dev",
    });

    it("targets the right namespace + name", () => {
      expect(job.metadata?.namespace).toBe("modeldoctor-benchmarks");
      expect(job.metadata?.name).toBe("benchmark-ckabc123");
    });

    it("labels the Job with the benchmark id", () => {
      expect(job.metadata?.labels).toMatchObject({
        "app.kubernetes.io/name": "modeldoctor-benchmark-runner",
        "modeldoctor.ai/benchmark-id": "ckabc123",
      });
    });

    it("disables retries (backoffLimit=0) and GCs after 1h", () => {
      expect(job.spec?.backoffLimit).toBe(0);
      expect(job.spec?.ttlSecondsAfterFinished).toBe(3600);
    });

    it("uses Never restart policy", () => {
      expect(job.spec?.template.spec?.restartPolicy).toBe("Never");
    });

    it("sets resource requests + limits to the hard-coded defaults", () => {
      const c = job.spec?.template.spec?.containers[0];
      expect(c?.resources).toEqual({
        requests: { cpu: "500m", memory: "512Mi" },
        limits: { cpu: "2", memory: "2Gi" },
      });
    });

    it("uses the configured image with IfNotPresent pull policy", () => {
      const c = job.spec?.template.spec?.containers[0];
      expect(c?.image).toBe("modeldoctor/benchmark-runner:dev");
      expect(c?.imagePullPolicy).toBe("IfNotPresent");
    });

    it("references the Secret via envFrom (sensitive vars not in env.value)", () => {
      const c = job.spec?.template.spec?.containers[0];
      expect(c?.envFrom).toEqual([{ secretRef: { name: "benchmark-ckabc123" } }]);
      const envNames = (c?.env ?? []).map((e) => e.name);
      expect(envNames).not.toContain("API_KEY");
      expect(envNames).not.toContain("CALLBACK_TOKEN");
    });

    it("populates non-sensitive env vars", () => {
      const c = job.spec?.template.spec?.containers[0];
      const env = Object.fromEntries((c?.env ?? []).map((e) => [e.name, e.value]));
      expect(env).toMatchObject({
        BENCHMARK_ID: "ckabc123",
        CALLBACK_URL: "http://modeldoctor-api.modeldoctor.svc:3001",
        TARGET_URL: "https://api.example.com/v1",
        MODEL: "llama-3-70b",
        API_TYPE: "chat",
        DATASET_NAME: "random",
        PROMPT_TOKENS: "1024",
        OUTPUT_TOKENS: "128",
        DATASET_SEED: "42",
        REQUEST_RATE: "0",
        TOTAL_REQUESTS: "1000",
        MAX_DURATION_SECONDS: "1800",
      });
    });

    it("omits DATASET_SEED when not provided", () => {
      const noSeedCtx = { ...ctx, datasetSeed: undefined };
      const j = buildJobManifest(noSeedCtx, {
        namespace: "ns",
        image: "img:tag",
      });
      const env = (j.spec?.template.spec?.containers[0]?.env ?? []).map((e) => e.name);
      expect(env).not.toContain("DATASET_SEED");
    });
  });
});
