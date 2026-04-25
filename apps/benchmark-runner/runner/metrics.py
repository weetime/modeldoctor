"""Map a guidellm JSON report to the BenchmarkMetricsSummary wire shape.

Defensive: any missing or null field defaults to 0. We choose not to crash
on malformed reports because (a) guidellm versions occasionally rename
fields and we'd rather ship slightly stale numbers than fail-the-run, (b)
the controller already has the rawMetrics blob for forensic reconstruction.
"""

from __future__ import annotations

from typing import Any


def _latency(metrics: dict[str, Any], key: str) -> dict[str, float]:
    # `or {}` guards against guidellm emitting a literal JSON null for the field.
    src = metrics.get(key) or {}
    # guidellm uses "median" for p50.
    return {
        "mean": float(src.get("mean") or 0),
        "p50": float(src.get("median") or 0),
        "p95": float(src.get("p95") or 0),
        "p99": float(src.get("p99") or 0),
    }


def _rate(metrics: dict[str, Any], key: str) -> dict[str, float]:
    src = metrics.get(key) or {}
    return {"mean": float(src.get("mean") or 0)}


def map_guidellm_report_to_summary(raw: dict[str, Any]) -> dict[str, Any]:
    """Translate guidellm's report JSON to the BenchmarkMetricsSummary shape.

    Missing fields default to 0 — see module docstring for rationale. The
    raw report is preserved unchanged on the BenchmarkRun row so anything
    the mapper drops can be reconstructed offline.
    """
    benches = raw.get("benchmarks") or []
    # We only emit one benchmark group per run, so take the first if any.
    first = benches[0] if benches else {}
    metrics = first.get("metrics") or {}
    summary_section = first.get("summary") or {}

    concurrency = metrics.get("request_concurrency") or {}
    requests_total = int(summary_section.get("requests") or 0)
    errors = int(summary_section.get("errors") or 0)
    incomplete = int(summary_section.get("incomplete") or 0)
    success = max(0, requests_total - errors - incomplete)

    return {
        "ttft": _latency(metrics, "time_to_first_token_ms"),
        "itl": _latency(metrics, "inter_token_latency_ms"),
        "e2eLatency": _latency(metrics, "request_latency_ms"),
        "requestsPerSecond": _rate(metrics, "requests_per_second"),
        "outputTokensPerSecond": _rate(metrics, "output_tokens_per_second"),
        "inputTokensPerSecond": _rate(metrics, "prompt_tokens_per_second"),
        "totalTokensPerSecond": _rate(metrics, "tokens_per_second"),
        "concurrency": {
            "mean": float(concurrency.get("mean") or 0),
            "max": float(concurrency.get("max") or 0),
        },
        "requests": {
            "total": requests_total,
            "success": success,
            "error": errors,
            "incomplete": incomplete,
        },
    }
