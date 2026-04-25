"""Map a guidellm JSON report to the BenchmarkMetricsSummary wire shape.

Defensive: any missing field defaults to 0/null. We choose not to crash on
malformed reports because (a) guidellm versions occasionally rename fields
and we'd rather ship slightly stale numbers than fail-the-run, (b) the
controller already has the rawMetrics blob for forensic reconstruction.
"""

from __future__ import annotations

from typing import Any


def _latency(metrics: dict[str, Any], key: str) -> dict[str, float]:
    src = metrics.get(key, {})
    # guidellm uses "median" for p50.
    return {
        "mean": float(src.get("mean", 0)),
        "p50": float(src.get("median", 0)),
        "p95": float(src.get("p95", 0)),
        "p99": float(src.get("p99", 0)),
    }


def _rate(metrics: dict[str, Any], key: str) -> dict[str, float]:
    src = metrics.get(key, {})
    return {"mean": float(src.get("mean", 0))}


def map_guidellm_report_to_summary(raw: dict[str, Any]) -> dict[str, Any]:
    """Translate guidellm's report JSON to the BenchmarkMetricsSummary shape.

    Missing fields default to 0 — see module docstring for rationale. The
    raw report is preserved unchanged on the BenchmarkRun row so anything
    the mapper drops can be reconstructed offline.
    """
    benches = raw.get("benchmarks", [])
    # We only emit one benchmark group per run, so take the first if any.
    first = benches[0] if benches else {}
    metrics = first.get("metrics", {})
    summary_section = first.get("summary", {})

    concurrency = metrics.get("request_concurrency", {})
    requests_total = int(summary_section.get("requests", 0))
    errors = int(summary_section.get("errors", 0))
    incomplete = int(summary_section.get("incomplete", 0))
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
            "mean": float(concurrency.get("mean", 0)),
            "max": float(concurrency.get("max", 0)),
        },
        "requests": {
            "total": requests_total,
            "success": success,
            "error": errors,
            "incomplete": incomplete,
        },
    }
