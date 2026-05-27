# ModelDoctor PrometheusRule baseline

PrometheusRule CRDs (kube-prometheus-operator format) that normalize raw
inference-engine, gateway, and accelerator metrics into the
`infer:*` namespace, then declare SLO alerts on top.

Background and design rationale:
[`docs/superpowers/research/2026-05-15-inference-engine-metrics-survey.md`](../../../docs/superpowers/research/2026-05-15-inference-engine-metrics-survey.md).

## Layout

```
recording/
  engines/
    vllm-common.yaml              ← vLLM shared metrics; auto-detects V0/V1 per instance. Apply with one or both version files below.
    vllm-v0.yaml                  ← vLLM 0.5.x / 0.6.x — version-specific metrics only
    vllm-v1.yaml                  ← vLLM 0.7.x+ — version-specific metrics only
    sglang-legacy.yaml            ← SGLang ≤ 0.5.3 (sglang: prefix)
    sglang-v0.5.4plus.yaml        ← SGLang ≥ 0.5.4 (sglang_ prefix)
    tgi.yaml                      ← HuggingFace TGI 1.x / 2.x
  gateway/
    higress.yaml                  ← apply if you run Higress AI Statistics
  accelerator/
    accelerator.yaml              ← unified NVIDIA + Ascend; safe to always apply
alerts/                           ← apply all four; they consume `infer:*` only
  request-slo.yaml                ← TTFT, queue, hang, preemption
  cache.yaml                      ← KV / prefix cache pressure
  accelerator.yaml                ← GPU/NPU health, thermal, memory
  gateway-consumer.yaml           ← multi-tenant isolation (Higress only)
```

## Design principle: version is engine

Each `(engine, major version)` is treated as a distinct engine type with
its own `engine` label, because the same engine renames metrics across
major versions. How that label is attached depends on whether the raw
metric NAMES collide between versions:

**vLLM V0 vs V1 — shared `vllm:` prefix AND many identical metric names**
(`vllm:num_requests_running`, `vllm:time_to_first_token_seconds`, …).
This is the one case where a per-version file cannot own a metric without
double-counting on a mixed fleet. So:

- Shared-name metrics live in **`vllm-common.yaml`** and get their
  `engine` label attached **per instance** by joining
  `infer:meta:engine_id` — a value-1 identity derived non-invasively from
  a version-exclusive gauge (`vllm:kv_cache_usage_perc` → V1,
  `vllm:gpu_cache_usage_perc` → V0). No scrape/pod-label changes needed.
- Version-exclusive metrics (cache semantics, TPOT source name) stay in
  `vllm-v0.yaml` / `vllm-v1.yaml` with a static `engine` label.
- On a **mixed V0+V1 fleet, apply `vllm-common.yaml` + BOTH version files**
  — the version files only define version-exclusive raw names, so there is
  no overlap.

**SGLang legacy vs v0.5.4+ — different prefixes** (`sglang:` vs `sglang_`).
No raw names collide, so each file naturally matches only its own
version's pods. Applying both is safe; no common file is needed.

The general rule: version-exclusive raw names can coexist directly;
only *shared* raw names need the discriminator join (today, only vLLM).

## How to apply

> **First check your Prometheus's `ruleSelector`.** If it is non-empty
> (kube-prometheus-stack uses `{release: <name>}`), a raw `kubectl apply`
> is **silently ignored** — the PrometheusRule must carry the matching
> label. Use the provided `kustomization.yaml` (which stamps the label
> without polluting the engine-neutral base files):
>
> ```bash
> # edit `release:` in kustomization.yaml to match your cluster, then:
> kubectl apply -k deploy/k8s/prometheus-rules/
> ```
>
> Inspect the selector with:
> `kubectl get prometheus -A -o jsonpath='{.items[*].spec.ruleSelector}'`

Raw apply (only when `ruleSelector` is empty `{}`):

```bash
# 1. vLLM: common (shared metrics, auto-attributes engine) + version file(s).
#    On a mixed V0+V1 fleet, apply common + BOTH version files.
kubectl apply -f recording/engines/vllm-common.yaml -n monitoring
kubectl apply -f recording/engines/vllm-v1.yaml -n monitoring   # and/or vllm-v0.yaml

# 2. (Optional) Gateway recording if you use Higress
kubectl apply -f recording/gateway/higress.yaml -n monitoring

# 3. Accelerator recording (safe regardless of vendor)
kubectl apply -f recording/accelerator/accelerator.yaml -n monitoring

# 4. Alert files
kubectl apply -f alerts/ -n monitoring
```

`ruleNamespaceSelector` on the `Prometheus` resource controls which
namespaces are searched (often `{}` = all); the `monitoring` namespace
above is just an example.

## Prerequisites

- **Prometheus Operator** (kube-prometheus-stack, rancher-monitoring,
  Coreweave, OpenShift Monitoring — anything that consumes the
  `monitoring.coreos.com/v1 PrometheusRule` CRD).
- Source metrics scraped into the same Prometheus instance:
  - For vLLM/SGLang/TGI: a `ServiceMonitor` or `PodMonitor` against the
    inference service's `/metrics` endpoint, with a `model_name` label
    (or `instance` if the engine doesn't export model name natively —
    see survey §9).
  - For Higress: the AI Statistics plugin enabled and its `/stats`
    endpoint scraped.
  - For DCGM: `nvidia-dcgm-exporter` running as DaemonSet.
  - For Huawei NPU: `npu-exporter` running as DaemonSet.

## Unit conventions (verify before production)

- Higress LLM duration counters are converted **microseconds → seconds**
  (divide by `1e6`). Some legacy plugin builds report milliseconds —
  if your normalized `infer:gateway:llm_duration_seconds:avg`
  is suspiciously 1000x off, change the divisor to `1e3` in
  `recording/gateway/higress.yaml`.
- DCGM `FB_USED` / `FB_TOTAL` are MiB; we convert to bytes.
- NPU `used_memory` / `total_memory` are MB (decimal); we treat them
  as MiB for symmetry with DCGM (i.e. `* 1024 * 1024`). The 5% drift
  is irrelevant for alerting but flag it if you build a billing-grade
  dashboard.

## Alert routing (next step)

Alert labels include `modeldoctor_scenario` (`ttft-jitter`,
`kv-cache-pressure`, `prefix-cache-regression`, `accelerator-fault`,
`accelerator-thermal`, `consumer-isolation`, …). Alertmanager will use
these to route everything to ModelDoctor's webhook receiver, where the
AI recommendation layer enriches with connection context.

The Alertmanager `receivers:` snippet and webhook contract are
not in this PR — see follow-up.
