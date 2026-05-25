"""HTTP callbacks: runner pod → API. Path layout v2 (#53)."""

from __future__ import annotations

import requests

_TIMEOUT_SECONDS = 10


def _join(callback_url: str, path: str) -> str:
    """Concatenate ``callback_url`` and ``path`` without double slashes.

    Drivers may pass ``MD_CALLBACK_URL=http://api/`` (trailing slash) or
    ``http://api`` (none); both must produce a single ``/api/internal/...``
    path component or NestJS strict routing returns 404.
    """
    return f"{callback_url.rstrip('/')}/{path.lstrip('/')}"


def _post(url: str, token: str, body: dict) -> None:
    resp = requests.post(
        url,
        json=body,
        headers={"Authorization": f"Bearer {token}"},
        timeout=_TIMEOUT_SECONDS,
    )
    if not resp.ok:
        raise RuntimeError(f"Callback POST {url} returned {resp.status_code}: {resp.text[:200]}")


def post_log_batch(
    *,
    callback_url: str,
    token: str,
    benchmark_id: str,
    stream: str,
    lines: list[str],
) -> None:
    """POST a batch of stdout/stderr lines to the v2 /log endpoint."""
    _post(
        _join(callback_url, f"api/internal/benchmarks/{benchmark_id}/log"),
        token,
        {"stream": stream, "lines": lines},
    )
