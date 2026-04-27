"""Map a guidellm 0.5.x JSON report to the BenchmarkMetricsSummary wire shape.

guidellm's report wraps every per-metric distribution in a
``StatusDistributionSummary`` keyed by request status (``successful``,
``errored``, ``incomplete``, ``total``). We surface the *successful* slice
because that's what users care about for latency / throughput numbers; the
rawMetrics blob preserves the other three for offline analysis. Each
distribution exposes ``mean`` / ``median`` / ``max`` at the top level and
nests p50/p95/p99 under ``percentiles``.

Defensive: any missing or null field defaults to 0. We choose not to crash
on malformed reports because (a) guidellm versions occasionally rename
fields and we'd rather ship slightly stale numbers than fail-the-run, (b)
the controller already has the rawMetrics blob for forensic reconstruction.
"""

from __future__ import annotations

from typing import Any


def _successful(metrics: dict[str, Any], key: str) -> dict[str, Any]:
    """Pull the StatusDistributionSummary's `.successful` slice for a metric."""
    sds = metrics.get(key) or {}
    return sds.get("successful") or {}


def _latency(metrics: dict[str, Any], key: str) -> dict[str, float]:
    src = _successful(metrics, key)
    pct = src.get("percentiles") or {}
    return {
        "mean": float(src.get("mean") or 0),
        # guidellm's DistributionSummary exposes both `median` and
        # `percentiles.p50` (mathematically equal). Prefer `percentiles.p50`
        # so the rest of the field-set comes from one consistent source.
        "p50": float(pct.get("p50") or src.get("median") or 0),
        "p95": float(pct.get("p95") or 0),
        "p99": float(pct.get("p99") or 0),
    }


def _rate(metrics: dict[str, Any], key: str) -> dict[str, float]:
    src = _successful(metrics, key)
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

    concurrency_src = _successful(metrics, "request_concurrency")
    totals = (metrics.get("request_totals") or {}) if metrics else {}

    return {
        "ttft": _latency(metrics, "time_to_first_token_ms"),
        "itl": _latency(metrics, "inter_token_latency_ms"),
        # `request_latency` (no `_ms` suffix in 0.5.x) is in seconds; the
        # wire shape historically expressed e2e latency in ms, so multiply.
        "e2eLatency": {k: v * 1000.0 for k, v in _latency(metrics, "request_latency").items()},
        "requestsPerSecond": _rate(metrics, "requests_per_second"),
        "outputTokensPerSecond": _rate(metrics, "output_tokens_per_second"),
        "inputTokensPerSecond": _rate(metrics, "prompt_tokens_per_second"),
        "totalTokensPerSecond": _rate(metrics, "tokens_per_second"),
        "concurrency": {
            "mean": float(concurrency_src.get("mean") or 0),
            "max": float(concurrency_src.get("max") or 0),
        },
        "requests": {
            "total": int(totals.get("total") or 0),
            "success": int(totals.get("successful") or 0),
            "error": int(totals.get("errored") or 0),
            "incomplete": int(totals.get("incomplete") or 0),
        },
    }
