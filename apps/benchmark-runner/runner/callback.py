"""Callback HTTP client — runner pod → API."""

from __future__ import annotations

from typing import Any

import requests

# Keep timeouts short — the API service is in-cluster and we don't want to
# block the runner forever if the network glitches. The reconciler will
# eventually mark a stuck run as failed.
_TIMEOUT_SECONDS = 10


def _post(url: str, token: str, body: dict[str, Any]) -> None:
    resp = requests.post(
        url,
        json=body,
        headers={"Authorization": f"Bearer {token}"},
        timeout=_TIMEOUT_SECONDS,
    )
    if not resp.ok:
        raise RuntimeError(f"Callback POST {url} returned {resp.status_code}: {resp.text[:200]}")


def post_state(
    *,
    callback_url: str,
    token: str,
    benchmark_id: str,
    state: str,
    message: str | None = None,
    progress: float | None = None,
) -> None:
    """POST a lifecycle update to the API."""
    body: dict[str, Any] = {"state": state}
    if message is not None:
        body["stateMessage"] = message
    if progress is not None:
        body["progress"] = progress
    _post(f"{callback_url}/api/internal/benchmarks/{benchmark_id}/state", token, body)


def post_metrics(
    *,
    callback_url: str,
    token: str,
    benchmark_id: str,
    summary: dict[str, Any],
    raw: dict[str, Any],
    logs: str | None,
) -> None:
    """POST the final metrics payload to the API."""
    body: dict[str, Any] = {"metricsSummary": summary, "rawMetrics": raw}
    if logs is not None:
        body["logs"] = logs
    _post(f"{callback_url}/api/internal/benchmarks/{benchmark_id}/metrics", token, body)
