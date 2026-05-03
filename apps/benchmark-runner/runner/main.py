"""Generic tool wrapper. Reads MD_* env, spawns argv, batches /log,
collects outputFiles, posts /finish.

Phase 3 of #53: replaces the guidellm-specific runner. This file
contains zero tool-specific knowledge.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import subprocess
import sys
import threading
import time
from collections import deque
from pathlib import Path

from runner.callback import post_finish, post_log_batch, post_state_running

LOG_BATCH_INTERVAL_SEC = 0.25
LOG_LINE_MAX_BYTES = 64 * 1024
# Bounds the /finish POST body and runner RSS for long-running benchmarks.
# /finish's stdout/stderr role is post-mortem only (/log already streamed
# everything live), so 64 KB per stream is sufficient for triage.
LOG_TAIL_MAX_BYTES = 64 * 1024  # per stream
# vegeta attack.bin for a long load test can exceed 100 MB; base64-encoding
# that entirely in memory would OOM the runner process.
OUTPUT_FILE_MAX_BYTES = 50 * 1024 * 1024  # per output file

logging.basicConfig(level=logging.INFO, format="[runner] %(message)s")
log = logging.getLogger("runner")


class StreamPump:
    """Drains a file-like stream into a full-buffer + a /log batch sender."""

    def __init__(self, stream, name: str, callback_url: str, token: str, run_id: str):
        self.stream = stream
        self.name = name
        self.callback_url = callback_url
        self.token = token
        self.run_id = run_id
        self.buffer: list[str] = []
        self.full: deque[str] = deque()
        self.full_bytes: int = 0
        self._stop = threading.Event()

    def run(self) -> None:
        last_flush = time.monotonic()
        while True:
            line_bytes = self.stream.readline()
            if not line_bytes:
                break
            try:
                line = line_bytes.decode("utf-8", errors="replace")
            except Exception:
                line = repr(line_bytes)
            line = line.rstrip("\n")[:LOG_LINE_MAX_BYTES]
            self.full.append(line)
            # +1 accounts for the \n that "\n".join(...) will reinsert on
            # read — keeps the byte accounting consistent with the output size.
            self.full_bytes += len(line.encode("utf-8")) + 1
            # Evict oldest lines until we are within the tail-byte cap so that
            # a 30-min benchmark's worth of progress output cannot exhaust RSS.
            while self.full_bytes > LOG_TAIL_MAX_BYTES and self.full:
                evicted = self.full.popleft()
                self.full_bytes -= len(evicted.encode("utf-8")) + 1
            self.buffer.append(line)
            now = time.monotonic()
            if now - last_flush >= LOG_BATCH_INTERVAL_SEC:
                self._flush()
                last_flush = now
        self._flush()

    def _flush(self) -> None:
        if not self.buffer:
            return
        try:
            post_log_batch(
                callback_url=self.callback_url,
                token=self.token,
                run_id=self.run_id,
                stream=self.name,
                lines=self.buffer,
            )
        except Exception as e:
            log.warning("post_log_batch failed: %s", e)
        self.buffer = []


def _materialize_input_files() -> None:
    """If MD_INPUT_FILE_PATHS is set (K8s mode), symlink mount paths to cwd.

    Subprocess driver writes inputFiles directly to cwd already, so this is
    a no-op there.
    """
    raw = os.environ.get("MD_INPUT_FILE_PATHS")
    if not raw:
        return
    mapping = json.loads(raw)
    cwd = Path.cwd()
    for alias, src_path in mapping.items():
        dst = cwd / alias
        try:
            if dst.exists() or dst.is_symlink():
                dst.unlink()
            dst.symlink_to(src_path)
        except OSError as e:
            log.warning("failed to symlink input file %s -> %s: %s", dst, src_path, e)


def _redacted(argv: list[str]) -> list[str]:
    """Mask --backend-kwargs= JSON since it can contain api_key."""
    out: list[str] = []
    for a in argv:
        if a.startswith("--backend-kwargs="):
            out.append("--backend-kwargs=***REDACTED***")
        else:
            out.append(a)
    return out


def _inject_api_key_into_backend_kwargs(argv: list[str]) -> list[str]:
    """Merge OPENAI_API_KEY env into any --backend-kwargs= JSON in argv.

    guidellm's openai_http backend reads api_key only from --backend-kwargs.
    The api side passes the apiKey via the OPENAI_API_KEY env var (as
    secretEnv) to keep it out of argv (which would leak into ps listings
    and process trees). This wrapper bridges the two: at exec time, before
    spawning guidellm, we merge the env value into the JSON.

    Behavior contract:
    - If OPENAI_API_KEY is unset, return argv unchanged.
    - If no `--backend-kwargs=` is present, return argv unchanged. (genai-perf
      and vegeta don't use this flag.)
    - For each `--backend-kwargs=` entry: parse JSON, set api_key only if
      the key is absent (don't overwrite an explicit adapter-supplied value),
      reserialize back into the same argv slot.
    - Malformed JSON is a programmer error and raises rather than swallowing.
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return argv
    out: list[str] = []
    for a in argv:
        if a.startswith("--backend-kwargs="):
            payload = a[len("--backend-kwargs="):]
            data = json.loads(payload)
            if "api_key" not in data:
                data["api_key"] = api_key
            out.append("--backend-kwargs=" + json.dumps(data))
        else:
            out.append(a)
    return out


def main() -> int:
    callback_url = os.environ["MD_CALLBACK_URL"]
    token = os.environ["MD_CALLBACK_TOKEN"]
    run_id = os.environ["MD_RUN_ID"]
    argv = json.loads(os.environ["MD_ARGV"])
    output_files = json.loads(os.environ["MD_OUTPUT_FILES"])

    _materialize_input_files()

    try:
        post_state_running(callback_url=callback_url, token=token, run_id=run_id)
    except Exception as e:
        log.warning("post_state_running failed: %s", e)

    argv = _inject_api_key_into_backend_kwargs(argv)
    log.info("running: %s", " ".join(_redacted(argv)))
    proc = subprocess.Popen(  # noqa: S603
        argv,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=os.getcwd(),
    )

    out_pump = StreamPump(proc.stdout, "stdout", callback_url, token, run_id)
    err_pump = StreamPump(proc.stderr, "stderr", callback_url, token, run_id)
    t1 = threading.Thread(target=out_pump.run, daemon=True)
    t2 = threading.Thread(target=err_pump.run, daemon=True)
    t1.start()
    t2.start()

    proc.wait()
    t1.join(timeout=5)
    t2.join(timeout=5)

    files_b64: dict[str, str] = {}
    for alias, rel_path in output_files.items():
        full = Path.cwd() / rel_path
        if not full.exists():
            continue
        size = full.stat().st_size
        if size > OUTPUT_FILE_MAX_BYTES:
            log.warning(
                "output file %s (%d bytes) exceeds %d byte cap; skipping",
                alias,
                size,
                OUTPUT_FILE_MAX_BYTES,
            )
            continue
        files_b64[alias] = base64.b64encode(full.read_bytes()).decode("ascii")

    state = "completed" if proc.returncode == 0 else "failed"
    message = None if state == "completed" else f"tool exited with code {proc.returncode}"

    # Snapshot deques into lists in case a daemon pump thread is still
    # alive after join(timeout=5) — protects against "deque mutated
    # during iteration" RuntimeError under unusual EOF behavior.
    try:
        post_finish(
            callback_url=callback_url,
            token=token,
            run_id=run_id,
            state=state,
            exit_code=proc.returncode,
            stdout="\n".join(list(out_pump.full)),
            stderr="\n".join(list(err_pump.full)),
            files=files_b64,
            message=message,
        )
    except Exception as e:
        log.error("post_finish failed: %s", e)
        return 1

    # Always exit 0 from the wrapper itself — failure of the inner tool is
    # already conveyed via /finish state=failed.
    return 0


if __name__ == "__main__":
    sys.exit(main())
