"""Generic tool wrapper. Reads MD_* env, spawns argv, collects outputFiles,
writes report to S3.

Phase 3 of #53: replaces the guidellm-specific runner. This file
contains zero tool-specific knowledge.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import threading
from collections import deque
from datetime import UTC, datetime
from pathlib import Path

from runner.s3_writer import S3Writer
from runner.storage_keys import file_key, keys_for

LOG_LINE_MAX_BYTES = 64 * 1024
# Bounds the S3 stdout/stderr objects and runner RSS for long-running benchmarks.
# stdout.log/stderr.log are post-mortem only (/log already streamed
# everything live), so 64 KB per stream is sufficient for triage.
LOG_TAIL_MAX_BYTES = 64 * 1024  # per stream
# S3 enforces its own object size limits; output files stream via put_file
# (multipart-aware for objects >5 MB), so no in-memory cap is needed here.
# Cap version string length stored in meta.json. The reportMetaSchema
# toolVersion field hard-caps at 50; truncating here mirrors that so a tool
# with a verbose `--version` banner doesn't violate the cap.
TOOL_VERSION_MAX_CHARS = 50
TOOL_VERSION_TIMEOUT_SEC = 10

logging.basicConfig(level=logging.INFO, format="[runner] %(message)s")
log = logging.getLogger("runner")


def _iso_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def detect_tool_version(tool: str) -> str | None:
    """Run ``<tool> --version`` and return the first stdout line stripped.

    Returns None if the tool is missing, the call times out, or it exits
    non-zero. Truncates to ``TOOL_VERSION_MAX_CHARS`` so a verbose banner
    can never violate the contract's ``z.string().max(50)``.
    """
    try:
        result = subprocess.run(  # noqa: S603 - argv is internal, not user-supplied
            [tool, "--version"],
            capture_output=True,
            text=True,
            timeout=TOOL_VERSION_TIMEOUT_SEC,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    raw = (result.stdout or result.stderr).strip()
    if not raw:
        return None
    line = raw.split("\n", 1)[0].strip()
    if not line:
        return None
    return line[:TOOL_VERSION_MAX_CHARS]


class StreamPump:
    """Drains a subprocess pipe into a bounded tail buffer (LOG_TAIL_MAX_BYTES).
    Phase 3: API now reads live logs directly via K8s pods/log:get; runner
    only retains the tail for the post-mortem stdout.log / stderr.log writes
    to S3 (Phase 2 path)."""

    def __init__(self, stream, name: str):
        self.stream = stream
        self.name = name
        self.full: deque[str] = deque()
        self.full_bytes: int = 0

    def run(self) -> None:
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
            # +1 accounts for the \n that "\n".join(...) reinserts on read
            self.full_bytes += len(line.encode("utf-8")) + 1
            while self.full_bytes > LOG_TAIL_MAX_BYTES and self.full:
                evicted = self.full.popleft()
                self.full_bytes -= len(evicted.encode("utf-8")) + 1


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
    """Mask secrets in argv for logging: --backend-kwargs= JSON (may contain
    api_key) and the value following --api-key (evalscope auth)."""
    out: list[str] = []
    mask_next = False
    for a in argv:
        if mask_next:
            out.append("***REDACTED***")
            mask_next = False
            continue
        if a.startswith("--backend-kwargs="):
            out.append("--backend-kwargs=***REDACTED***")
        elif a == "--api-key":
            out.append(a)
            mask_next = True
        else:
            out.append(a)
    return out


# Sentinel emitted by adapters that must pass the API key as a CLI flag the
# tool reads ONLY from argv (e.g. evalscope `--api-key`, which ignores env).
# The adapter puts this placeholder in argv so the secret never lands in the
# K8s Job manifest / MD_ARGV; the runner swaps in OPENAI_API_KEY (from the
# per-run Secret, via secretEnv) immediately before Popen. Mirrors the guidellm
# api_key handling but for tools without an env-var or backend-kwargs channel.
# Contract: packages/tool-adapters/src/evalscope/runtime.ts.
OPENAI_API_KEY_SENTINEL = "__MD_OPENAI_API_KEY__"


def _inject_api_key_sentinel(argv: list[str]) -> list[str]:
    """Replace the OPENAI_API_KEY sentinel token in argv with the real key.

    If OPENAI_API_KEY is unset, the sentinel becomes an empty string (the tool
    then sees an empty --api-key, equivalent to no auth configured).
    """
    api_key = os.environ.get("OPENAI_API_KEY", "")
    return [api_key if a == OPENAI_API_KEY_SENTINEL else a for a in argv]


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
            payload = a[len("--backend-kwargs=") :]
            data = json.loads(payload)
            if "api_key" not in data:
                data["api_key"] = api_key
            out.append("--backend-kwargs=" + json.dumps(data))
        else:
            out.append(a)
    return out


def main() -> int:
    benchmark_id = os.environ["MD_BENCHMARK_ID"]
    argv = json.loads(os.environ["MD_ARGV"])
    output_files = json.loads(os.environ["MD_OUTPUT_FILES"])

    _materialize_input_files()

    # argv[0] is the tool binary (e.g. "guidellm", "vegeta", "genai-perf").
    # We sniff its --version *before* the api-key injection step so that
    # `vegeta --version` and friends never see an unrelated --backend-kwargs.
    tool_name = argv[0] if argv else None
    tool_version = detect_tool_version(tool_name) if tool_name else None
    if tool_version is None and tool_name:
        log.warning("detect_tool_version(%s) returned None", tool_name)

    # S3 writer — fail-fast if env is misconfigured.
    s3 = S3Writer.from_env()
    keys = keys_for(benchmark_id)

    # 1. Write meta.json — runner has started, tool version known.
    s3.put_json(
        keys.meta,
        {
            "toolVersion": tool_version or "",
            "startTimeIso": _iso_now(),
        },
    )

    argv = _inject_api_key_into_backend_kwargs(argv)
    argv = _inject_api_key_sentinel(argv)
    log.info("running: %s", " ".join(_redacted(argv)))
    proc = subprocess.Popen(  # noqa: S603
        argv,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=os.getcwd(),
    )

    out_pump = StreamPump(proc.stdout, "stdout")
    err_pump = StreamPump(proc.stderr, "stderr")
    t1 = threading.Thread(target=out_pump.run, daemon=True)
    t2 = threading.Thread(target=err_pump.run, daemon=True)
    t1.start()
    t2.start()

    proc.wait()
    t1.join(timeout=5)
    t2.join(timeout=5)

    # 2. Upload output files via put_file (auto-multipart for >5 MB)
    files_map: dict[str, str] = {}
    for alias, rel_path in output_files.items():
        full = Path.cwd() / rel_path
        if not full.exists():
            continue
        rel = f"files/{alias}"
        s3.put_file(file_key(benchmark_id, alias), str(full))
        files_map[alias] = rel

    # 3. Upload stdout/stderr (tailed buffer from StreamPump)
    # Snapshot deques into lists in case a daemon pump thread is still
    # alive after join(timeout=5) — protects against "deque mutated
    # during iteration" RuntimeError under unusual EOF behavior.
    s3.put_text(keys.stdout, "\n".join(list(out_pump.full)))
    s3.put_text(keys.stderr, "\n".join(list(err_pump.full)))

    # 4. Sentinel — result.json LAST. API uses this to determine "storage complete".
    s3.put_json(
        keys.result,
        {
            "exitCode": proc.returncode,
            "finishTimeIso": _iso_now(),
            "files": files_map,
        },
    )

    # Propagate the tool's exit code so pod.phase reflects success/failure.
    # Watcher: exit=0 → pod.Succeeded → ReportLoader; exit!=0 → pod.Failed → failed-terminal.
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
