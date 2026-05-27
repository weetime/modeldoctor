# ModelDoctor PrometheusRule baseline

PrometheusRule CRDs (kube-prometheus-operator format) that normalize raw
inference-engine, gateway, and accelerator metrics into the
`infer:*` namespace, then declare SLO alerts on top.

Background and design rationale:
[`docs/superpowers/research/2026-05-15-inference-engine-metrics-survey.md`](../../../docs/superpowers/research/2026-05-15-inference-engine-metrics-survey.md).

## Layout

```
recording/
  engines/                        ← apply ONE per engine type per replica
    vllm-v0.yaml                  ← vLLM 0.5.x / 0.6.x
    vllm-v1.yaml                  ← vLLM 0.7.x+
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

Do NOT apply both `vllm-v0.yaml` and `vllm-v1.yaml` against the same
inference replica. The two engine types are mutually exclusive — they
target different raw metric names. Pick the one matching your deployed
vLLM version. Same for `sglang-legacy.yaml` vs `sglang-v0.5.4plus.yaml`.

Why: each rule file hard-codes its `engine` label and reads the raw
metric names from the specific vLLM/SGLang major version. Layering two
files would produce duplicate normalized series with different `engine`
label values, which breaks downstream alert grouping and AI context join.

## How to apply

```bash
# 1. Pick one engine recording file matching your inference workload
kubectl apply -f recording/engines/vllm-v1.yaml -n monitoring

# 2. (Optional) Apply gateway recording if you use Higress
kubectl apply -f recording/gateway/higress.yaml -n monitoring

# 3. Apply accelerator recording (safe regardless of vendor)
kubectl apply -f recording/accelerator/accelerator.yaml -n monitoring

# 4. Apply all four alert files
kubectl apply -f alerts/ -n monitoring
```

The namespace `monitoring` is the kube-prometheus-stack default; adjust
to wherever your Prometheus instance reads PrometheusRule from
(check `Prometheus.spec.ruleSelector` + `ruleNamespaceSelector` on
your `Prometheus` resource).

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
