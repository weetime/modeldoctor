import { describe, expect, it } from "vitest";
import type { GpustackModel } from "../gpustack/types.js";
import {
  buildSnapshot,
  canonicalize,
  deploymentFingerprint,
  diffSnapshots,
} from "./fingerprint.js";

const base: GpustackModel = {
  id: 1,
  name: "qwen",
  backend: "vLLM",
  backend_version: "0.10.1",
  backend_parameters: ["--max-num-seqs=256", "--enable-prefix-caching"],
  env: { B: "2", A: "1" },
  replicas: 1,
  ready_replicas: 1,
  source: "huggingface",
  huggingface_repo_id: "Qwen/Qwen3-8B",
};

describe("canonicalize", () => {
  it("sorts object keys recursively and drops null/undefined", () => {
    expect(canonicalize({ b: 1, a: { d: null, c: 2 }, e: undefined })).toEqual({
      a: { c: 2 },
      b: 1,
    });
  });
  it("keeps array order", () => {
    expect(canonicalize(["b", "a"])).toEqual(["b", "a"]);
  });
});

describe("deploymentFingerprint", () => {
  it("ignores replicas / ready_replicas / name", () => {
    const a = deploymentFingerprint(base);
    const b = deploymentFingerprint({ ...base, replicas: 4, ready_replicas: 0, name: "renamed" });
    expect(a).toBe(b);
  });
  it("is stable under env key order and null vs missing", () => {
    const a = deploymentFingerprint(base);
    const b = deploymentFingerprint({ ...base, env: { A: "1", B: "2" }, image_name: null });
    expect(a).toBe(b);
  });
  it("changes when backend_parameters change", () => {
    const a = deploymentFingerprint(base);
    const b = deploymentFingerprint({
      ...base,
      backend_parameters: ["--max-num-seqs=512", "--enable-prefix-caching"],
    });
    expect(a).not.toBe(b);
  });
  it("changes when backend_version changes", () => {
    expect(deploymentFingerprint(base)).not.toBe(
      deploymentFingerprint({ ...base, backend_version: "0.11.0" }),
    );
  });
  it("returns 64-char hex", () => {
    expect(deploymentFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("buildSnapshot", () => {
  it("includes fingerprint fields plus running-instance display info", () => {
    const s = buildSnapshot(base, [
      {
        id: 9,
        model_id: 1,
        state: "running",
        worker_name: "w1",
        gpu_type: "A100",
        gpu_indexes: [0, 1],
        api_detected_backend_version: "0.10.1",
      },
      { id: 10, model_id: 1, state: "error", worker_name: "w2" },
    ]);
    expect(s.backend_version).toBe("0.10.1");
    expect(s.instances).toEqual([
      { worker: "w1", gpuType: "A100", gpuCount: 2, detectedBackendVersion: "0.10.1" },
    ]);
  });
});

describe("diffSnapshots", () => {
  it("returns all non-empty fields when prev is null", () => {
    const d = diffSnapshots(null, { backend: "vLLM" });
    expect(d).toEqual([{ field: "backend", before: null, after: "vLLM" }]);
  });
  it("returns only changed fields", () => {
    const d = diffSnapshots(
      { backend: "vLLM", backend_version: "0.10.1", instances: [] },
      { backend: "vLLM", backend_version: "0.11.0", instances: [] },
    );
    expect(d).toEqual([{ field: "backend_version", before: "0.10.1", after: "0.11.0" }]);
  });
});
