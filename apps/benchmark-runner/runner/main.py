"""Runner entrypoint — reads env, runs guidellm, posts callbacks, exits 0/1."""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys

from runner.argv import build_guidellm_argv
from runner.callback import post_metrics, post_state
from runner.env import MissingEnvError, parse_env
from runner.metrics import map_guidellm_report_to_summary

# Default location for guidellm's --output-path. Tests patch this.
_OUTPUT_PATH = "/tmp/report.json"

# Tail size for stderr included in the state=failed callback. Sized to fit
# inside the API's 2 KB stateMessage cap with room for the "guidellm exited
# N: " prefix.
_STDERR_TAIL_BYTES = 1024

# Tail size for stdout shipped as `logs` on the metrics callback. guidellm's
# progress output for a 30-min / 1k-request run is easily MBs; an uncapped
# blob would overflow either an API body limit or the DB column. 16 KB is
# generous for post-mortem debugging without risking either.
_STDOUT_TAIL_BYTES = 16 * 1024

logging.basicConfig(level=logging.INFO, format="[runner] %(message)s")
log = logging.getLogger("runner")


def _log_tail(buf: bytes, max_bytes: int) -> str:
    """Decode the last ``max_bytes`` of a captured stream as UTF-8 (lossy)."""
    if not buf:
        return ""
    tail = buf[-max_bytes:]
    try:
        return tail.decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001 — defensive
        return repr(tail)


def _redacted_argv(argv: list[str]) -> list[str]:
    """Return ``argv`` with secret-bearing flags rewritten for safe logging.

    The orchestrator logs the full benchmark-runner argv on startup and the
    captured stdout/stderr later flow into the metrics callback's ``logs``
    field — so the API + DB will end up with whatever appears here. Any flag
    we know carries a secret must be redacted before that log line emits.
    """
    redacted: list[str] = []
    for a in argv:
        # --backend-kwargs JSON contains api_key (see runner.argv).
        if a.startswith("--backend-kwargs="):
            redacted.append("--backend-kwargs=***REDACTED***")
        else:
            redacted.append(a)
    return redacted


def main() -> int:
    """Run a single benchmark; return process exit code."""
    raw_env = dict(os.environ)
    callback_url = raw_env.get("CALLBACK_URL")
    callback_token = raw_env.get("CALLBACK_TOKEN")
    benchmark_id = raw_env.get("BENCHMARK_ID")

    try:
        cfg = parse_env(raw_env)
    except (MissingEnvError, ValueError) as e:
        log.error("env parse failed: %s", e)
        # Best-effort failure callback if we know enough URL/token/id.
        if callback_url and callback_token and benchmark_id:
            try:
                post_state(
                    callback_url=callback_url,
                    token=callback_token,
                    benchmark_id=benchmark_id,
                    state="failed",
                    message=f"env parse: {e}",
                )
            except Exception as cb_e:  # noqa: BLE001
                log.error("failed to post failure callback: %s", cb_e)
        return 1

    # state=running before doing anything heavy.
    try:
        post_state(
            callback_url=cfg.callback_url,
            token=cfg.callback_token,
            benchmark_id=cfg.benchmark_id,
            state="running",
        )
    except Exception as e:  # noqa: BLE001
        log.error("running callback failed: %s — continuing anyway", e)

    argv = build_guidellm_argv(cfg, output_path=_OUTPUT_PATH)
    log.info("running: %s", " ".join(_redacted_argv(argv)))
    proc = subprocess.run(argv, capture_output=True, check=False)  # noqa: S603

    if proc.returncode != 0:
        msg = f"guidellm exited {proc.returncode}: {_log_tail(proc.stderr, _STDERR_TAIL_BYTES)}"
        log.error(msg)
        try:
            post_state(
                callback_url=cfg.callback_url,
                token=cfg.callback_token,
                benchmark_id=cfg.benchmark_id,
                state="failed",
                message=msg[:2048],
            )
        except Exception as e:  # noqa: BLE001
            log.error("failed callback also failed: %s", e)
        return 1

    # Parse the report file produced by guidellm.
    try:
        with open(_OUTPUT_PATH) as f:
            report = json.load(f)
    except Exception as e:  # noqa: BLE001
        log.error("failed to read report at %s: %s", _OUTPUT_PATH, e)
        try:
            post_state(
                callback_url=cfg.callback_url,
                token=cfg.callback_token,
                benchmark_id=cfg.benchmark_id,
                state="failed",
                message=f"report parse: {e}",
            )
        except Exception as cb_e:  # noqa: BLE001
            log.error("failed to post failure callback: %s", cb_e)
        return 1

    summary = map_guidellm_report_to_summary(report)

    # Final metrics + completed.
    try:
        post_metrics(
            callback_url=cfg.callback_url,
            token=cfg.callback_token,
            benchmark_id=cfg.benchmark_id,
            summary=summary,
            raw=report,
            logs=_log_tail(proc.stdout, _STDOUT_TAIL_BYTES) or None,
        )
        post_state(
            callback_url=cfg.callback_url,
            token=cfg.callback_token,
            benchmark_id=cfg.benchmark_id,
            state="completed",
            progress=1.0,
        )
    except Exception as e:  # noqa: BLE001
        log.error("final callback failed: %s", e)
        # Don't return 1 — guidellm succeeded, we just couldn't tell anyone.
        # The reconciler will pick this up.
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
