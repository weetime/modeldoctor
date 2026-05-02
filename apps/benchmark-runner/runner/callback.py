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


def post_state_running(*, callback_url: str, token: str, run_id: str) -> None:
    """POST {state: 'running'} to the v2 /state endpoint."""
    _post(
        _join(callback_url, f"api/internal/runs/{run_id}/state"),
        token,
        {"state": "running"},
    )


def post_log_batch(
    *,
    callback_url: str,
    token: str,
    run_id: str,
    stream: str,
    lines: list[str],
) -> None:
    """POST a batch of stdout/stderr lines to the v2 /log endpoint."""
    _post(
        _join(callback_url, f"api/internal/runs/{run_id}/log"),
        token,
        {"stream": stream, "lines": lines},
    )


def post_finish(
    *,
    callback_url: str,
    token: str,
    run_id: str,
    state: str,
    exit_code: int,
    stdout: str,
    stderr: str,
    files: dict[str, str],
    message: str | None,
) -> None:
    """POST the terminal payload (state, exit code, full logs, output files)
    to the v2 /finish endpoint."""
    body: dict = {
        "state": state,
        "exitCode": exit_code,
        "stdout": stdout,
        "stderr": stderr,
        "files": files,
    }
    if message is not None:
        body["message"] = message
    _post(_join(callback_url, f"api/internal/runs/{run_id}/finish"), token, body)
