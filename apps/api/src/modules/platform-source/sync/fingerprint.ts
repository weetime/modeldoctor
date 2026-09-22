import { createHash } from "node:crypto";
import type { SnapshotDiffEntry } from "@modeldoctor/contracts";
import type { GpustackInstance, GpustackModel } from "../gpustack/types.js";

/** 进入部署指纹的字段（spec §5.2 第 5 步）。replicas / name / meta 等刻意排除。 */
export const FINGERPRINT_FIELDS = [
  "backend",
  "backend_version",
  "backend_parameters",
  "image_name",
  "run_command",
  "env",
  "gpu_selector",
  "gpu_type_selector",
  "worker_selector",
  "extended_kv_cache",
  "placement_strategy",
  "distributed_inference_across_workers",
  "cpu_offloading",
  "source",
  "huggingface_repo_id",
  "huggingface_filename",
  "model_scope_model_id",
  "model_scope_file_path",
  "local_path",
] as const;

/** key 排序、丢弃 null/undefined（null 与缺失等价）、数组保序。 */
export function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val === null || val === undefined) continue;
      out[k] = canonicalize(val);
    }
    return out;
  }
  return v;
}

function pickFingerprintFields(m: GpustackModel): Record<string, unknown> {
  const src = m as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of FINGERPRINT_FIELDS) out[f] = src[f];
  return out;
}

export function deploymentFingerprint(m: GpustackModel): string {
  const canonical = canonicalize(pickFingerprintFields(m));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function buildSnapshot(
  m: GpustackModel,
  instances: GpustackInstance[],
): Record<string, unknown> {
  const fields = canonicalize(pickFingerprintFields(m)) as Record<string, unknown>;
  const running = instances
    .filter((i) => i.model_id === m.id && i.state === "running")
    .map((i) => ({
      worker: i.worker_name ?? null,
      gpuType: i.gpu_type ?? null,
      gpuCount: i.gpu_indexes?.length ?? 0,
      detectedBackendVersion: i.api_detected_backend_version ?? null,
    }));
  return { ...fields, instances: running };
}

export function diffSnapshots(
  prev: Record<string, unknown> | null,
  next: Record<string, unknown>,
): SnapshotDiffEntry[] {
  const keys = new Set([...Object.keys(prev ?? {}), ...Object.keys(next)]);
  keys.delete("instances"); // 展示信息，不参与 diff
  const out: SnapshotDiffEntry[] = [];
  for (const field of [...keys].sort()) {
    const before = prev?.[field] ?? null;
    const after = next[field] ?? null;
    if (JSON.stringify(canonicalize(before)) !== JSON.stringify(canonicalize(after))) {
      out.push({ field, before, after });
    }
  }
  return out;
}
