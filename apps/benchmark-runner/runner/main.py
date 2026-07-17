"""Generic tool wrapper. Reads MD_* env, spawns argv, collects outputFiles,
writes report to S3.

Phase 3 of #53: replaces the guidellm-specific runner. This file
contains zero tool-specific knowledge.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import re
import subprocess
import sys
import threading
from collections import deque
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol, TextIO

from runner.local_writer import LocalWriter
from runner.s3_writer import S3Writer
from runner.storage_keys import checkpoint_prefix, file_key, keys_for


class Writer(Protocol):
    """The output sink surface main() + checkpointing depend on.

    Both S3Writer (online / k8s) and LocalWriter (offline mount) satisfy it,
    producing the identical <id>/... key layout.
    """

    def put_json(self, key: str, obj: object) -> None: ...
    def put_text(self, key: str, text: str) -> None: ...
    def put_file(self, key: str, local_path: str) -> None: ...
    def list_keys(self, prefix: str) -> list[str]: ...
    def download_prefix(self, prefix: str, local_dir: str) -> int: ...


def select_sink() -> Writer:
    """Pick the output sink: S3 when configured (online / k8s, zero change),
    else a local mount (offline), else fail-fast."""
    if os.environ.get("S3_ENDPOINT"):
        return S3Writer.from_env()
    if os.environ.get("MD_OUTPUT_DIR"):
        return LocalWriter.from_env()
    raise SystemExit("no output sink: set S3_* (online) or MD_OUTPUT_DIR (offline)")


LOG_LINE_MAX_BYTES = 64 * 1024
# Bounds the S3 stdout/stderr objects and runner RSS for long-running benchmarks.
# stdout.log/stderr.log are post-mortem only (the live stream is the pod log,
# which StreamPump tees to), so 64 KB per stream is sufficient for triage.
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
    """Run a --version probe and return the first stdout line stripped.

    Probes ``[tool, "--version"]`` by default. An adapter whose argv[0]
    isn't the tool's own version-reporting binary (e.g. vllm-omni-bench
    runs as ``python -m runner.tools.omni_driver`` — argv[0] is "python",
    whose ``--version`` reports the interpreter, not the tool) can set the
    ``MD_TOOL_VERSION_ARGV`` env var to a JSON argv array to probe instead.
    This is a GENERIC escape hatch: main.py stays zero-tool-specific-
    knowledge — the override is opt-in, supplied by the adapter's
    buildCommand(), never hardcoded here. Unset (the common case): behavior
    is unchanged.

    Returns None if the tool/override is missing, the call times out, or it
    exits non-zero. Truncates to ``TOOL_VERSION_MAX_CHARS`` so a verbose
    banner can never violate the contract's ``z.string().max(50)``.
    """
    probe_argv = [tool, "--version"]
    override = os.environ.get("MD_TOOL_VERSION_ARGV")
    if override:
        try:
            parsed = json.loads(override)
            if (
                not isinstance(parsed, list)
                or not parsed
                or not all(isinstance(a, str) for a in parsed)
            ):
                raise ValueError("MD_TOOL_VERSION_ARGV must be a non-empty JSON array of strings")
            probe_argv = parsed
        except (json.JSONDecodeError, ValueError) as e:
            log.warning("ignoring malformed MD_TOOL_VERSION_ARGV=%r: %s", override, e)
    try:
        result = subprocess.run(  # noqa: S603 - argv is internal, not user-supplied
            probe_argv,
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
    """Tees a subprocess pipe to ``sink`` (the runner's own stdout/stderr) AND
    into a bounded tail buffer (LOG_TAIL_MAX_BYTES).

    The tee is what makes the tool's output visible *live*: the API reads the
    K8s pod log via pods/log:get, and ``kubectl logs`` reads the same stream.
    Without it the pod log carries only the runner's own ``[runner]`` framing
    lines and the tool's actual output would surface only post-mortem in the
    S3 stdout.log / stderr.log objects (the tail buffer below)."""

    def __init__(self, stream, name: str, sink: TextIO):
        self.stream = stream
        self.name = name
        self.sink = sink
        self.full: deque[str] = deque()
        self.full_bytes: int = 0
        # Guards full/full_bytes. The pump runs on a daemon thread while main()
        # snapshots the tail after join(timeout=5), which may elapse with the
        # thread still alive under unusual EOF behavior — iterating the deque
        # mid-append would raise "deque mutated during iteration".
        self._lock = threading.Lock()

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
            # Tee to the pod log (flush so it streams live). A broken sink must
            # not kill the pump — the S3 tail is the source of truth post-mortem.
            # Kept outside the lock so a slow flush never blocks snapshot().
            with contextlib.suppress(ValueError, OSError):
                print(line, file=self.sink, flush=True)
            with self._lock:
                self.full.append(line)
                # +1 accounts for the \n that "\n".join(...) reinserts on read
                self.full_bytes += len(line.encode("utf-8")) + 1
                while self.full_bytes > LOG_TAIL_MAX_BYTES and self.full:
                    evicted = self.full.popleft()
                    self.full_bytes -= len(evicted.encode("utf-8")) + 1

    def snapshot(self) -> list[str]:
        """Copy the tail buffer under the lock so a still-running pump thread
        can't trigger a 'deque mutated during iteration' RuntimeError."""
        with self._lock:
            return list(self.full)


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
    api_key), the value following --api-key (evalscope auth), and any
    "api_key":"..." pair embedded elsewhere (e.g. tau2's --*-llm-args JSON,
    after a __MD_SECRET_<NAME>__ token has been swapped for a real key)."""
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
            # Value may itself be JSON-escaped (see _inject_named_secrets):
            # a literal `\"` or `\\` inside it must NOT be mistaken for the
            # closing quote, or the tail of the secret leaks in cleartext.
            # `(?:[^"\\]|\\.)*` consumes escaped pairs atomically so only an
            # unescaped `"` ends the match.
            out.append(re.sub(r'("api_key"\s*:\s*")(?:[^"\\]|\\.)*', r"\1***", a))
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


# Generic named-secret sentinel: __MD_SECRET_<NAME>__ -> os.environ[<NAME>].
# Generalizes OPENAI_API_KEY_SENTINEL for tools that need MULTIPLE distinct
# secrets in argv (e.g. tau2-bench's agent-endpoint and user-simulator-endpoint
# API keys, each embedded inside a separate --*-llm-args JSON blob). Adapters
# emit this token so every secret stays out of the persisted K8s manifest /
# MD_ARGV; the runner swaps in the real value (from per-run Secret env) just
# before Popen. Unknown env names are left as-is (not our job to validate
# which secrets a given tool declares).
_NAMED_SECRET_RE = re.compile(r"__MD_SECRET_([A-Z0-9_]+)__")


def _inject_named_secrets(argv: list[str]) -> list[str]:
    """Replace __MD_SECRET_<NAME>__ tokens with os.environ[<NAME>].

    Generalizes the single OPENAI_API_KEY sentinel so a tool needing
    multiple distinct secrets in argv (e.g. tau2's agent + user endpoint
    keys inside --*-llm-args JSON) can keep every key out of the persisted
    MD_ARGV / K8s manifest. Unknown env names are left as-is.

    Escaping contract: named-secret sentinels are substituted with a value
    escaped for a JSON-string-inside-single-quoted-shell context — the
    context tool adapters emit them in (see tau2's build-command, which
    wraps `--agent-llm-args '{"api_key":"__MD_SECRET_...__"}'`). The
    substituted value is escaped for BOTH layers it sits in, in this order:
    (1) JSON string escaping (`\\` -> `\\\\`, `"` -> `\\"`) — no surrounding
    quotes are added, the template already supplies them; then (2) shell
    single-quote escaping (`'` -> `'\\''`) so a value containing `'` cannot
    break out of the enclosing `'...'` argv token. Without this: a secret
    containing `'` is a (self-scoped) shell-injection vector, and one
    containing `"` or `\\` corrupts the tool's JSON parse.
    """

    def _escape(val: str) -> str:
        json_escaped = val.replace("\\", "\\\\").replace('"', '\\"')
        return json_escaped.replace("'", "'\\''")

    def sub(m: re.Match) -> str:
        val = os.environ.get(m.group(1))
        return _escape(val) if val is not None else m.group(0)

    return [_NAMED_SECRET_RE.sub(sub, a) for a in argv]


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


def _checkpoint_dir_abs() -> str | None:
    """Resolve MD_CHECKPOINT_DIR relative to Path.cwd(); None if unset.

    Gate for the whole checkpoint feature (Task 3): every call site below
    is a no-op when this returns None, so tools that don't set
    MD_CHECKPOINT_DIR (i.e. everything except tau3) see zero behavior
    change.
    """
    rel = os.environ.get("MD_CHECKPOINT_DIR")
    if not rel:
        return None
    return str(Path.cwd() / rel)


def _upload_checkpoint_once(s3: Writer, run_id: str, dir_abs: str) -> None:
    """Walk dir_abs and put_file every file under <run_id>/checkpoint/<rel>."""
    if not os.path.isdir(dir_abs):
        return
    prefix = checkpoint_prefix(run_id)
    for root, _dirs, files in os.walk(dir_abs):
        for name in files:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, dir_abs)
            s3.put_file(f"{prefix}{rel}", full)


class _CheckpointUploader(threading.Thread):
    """Background daemon that periodically flushes the tool's checkpoint dir
    to S3 so a killed/preempted run can resume from the last interval.

    Best-effort: an upload failure is logged and retried on the next tick,
    never raised into the run (a checkpoint hiccup must not fail the
    benchmark itself).
    """

    def __init__(self, s3: Writer, run_id: str, dir_abs: str, interval: float):
        super().__init__(daemon=True)
        self._s3, self._run_id, self._dir, self._interval = s3, run_id, dir_abs, interval
        # NOTE: named _stop_event, NOT _stop — threading.Thread already owns a
        # private _stop() method it calls internally from join()/_wait_for_
        # tstate_lock(); an attribute named self._stop shadows it and makes
        # join() raise "TypeError: 'Event' object is not callable".
        self._stop_event = threading.Event()

    def run(self) -> None:
        while not self._stop_event.wait(self._interval):
            try:
                _upload_checkpoint_once(self._s3, self._run_id, self._dir)
            except Exception as e:  # noqa: BLE001 - checkpoint is best-effort
                log.warning("checkpoint upload failed (will retry): %s", e)

    def stop(self) -> None:
        self._stop_event.set()


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

    # Output sink — S3 online, local mount offline; fail-fast if neither set.
    sink = select_sink()
    keys = keys_for(benchmark_id)

    # 1. Write meta.json — runner has started, tool version known.
    sink.put_json(
        keys.meta,
        {
            "toolVersion": tool_version or "",
            "startTimeIso": _iso_now(),
        },
    )

    argv = _inject_api_key_into_backend_kwargs(argv)
    argv = _inject_api_key_sentinel(argv)
    argv = _inject_named_secrets(argv)
    log.info("running: %s", " ".join(_redacted(argv)))

    # Restore-from-checkpoint (gated): only when the tool declared a
    # checkpoint dir AND the run was launched as a resume. A fresh run with
    # MD_CHECKPOINT_DIR set but MD_RESUME unset starts clean (no restore).
    ckpt_dir = _checkpoint_dir_abs()
    if ckpt_dir and os.environ.get("MD_RESUME") == "1":
        try:
            n = sink.download_prefix(checkpoint_prefix(benchmark_id), ckpt_dir)
            log.info("restored %d checkpoint file(s) into %s", n, ckpt_dir)
        except Exception as e:  # noqa: BLE001 - restore is best-effort; proceed with a clean run
            log.warning("checkpoint restore failed, continuing without prior state: %s", e)

    proc = subprocess.Popen(  # noqa: S603
        argv,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=os.getcwd(),
    )

    out_pump = StreamPump(proc.stdout, "stdout", sys.stdout)
    err_pump = StreamPump(proc.stderr, "stderr", sys.stderr)
    t1 = threading.Thread(target=out_pump.run, daemon=True)
    t2 = threading.Thread(target=err_pump.run, daemon=True)
    t1.start()
    t2.start()

    # Periodic checkpoint upload (gated): starts only when the tool declared
    # a checkpoint dir, independent of MD_RESUME (a fresh run still needs to
    # persist checkpoints so a LATER resume has something to restore).
    uploader = None
    if ckpt_dir:
        interval = float(os.environ.get("MD_CHECKPOINT_INTERVAL_SEC", "60"))
        uploader = _CheckpointUploader(sink, benchmark_id, ckpt_dir, interval)
        uploader.start()

    proc.wait()
    t1.join(timeout=5)
    t2.join(timeout=5)

    if uploader:
        uploader.stop()
        uploader.join(timeout=10)
        try:
            _upload_checkpoint_once(sink, benchmark_id, ckpt_dir)  # final flush — best-effort
        except Exception as e:  # noqa: BLE001 - checkpoint is best-effort, must not crash the run
            log.warning("final checkpoint flush failed: %s", e)

    # 2. Upload output files via put_file (auto-multipart for >5 MB)
    files_map: dict[str, str] = {}
    for alias, rel_path in output_files.items():
        full = Path.cwd() / rel_path
        if not full.exists():
            continue
        rel = f"files/{alias}"
        sink.put_file(file_key(benchmark_id, alias), str(full))
        files_map[alias] = rel

    # 3. Upload stdout/stderr (tailed buffer from StreamPump).
    # snapshot() copies under the pump's lock so a daemon pump thread still
    # alive after join(timeout=5) (unusual EOF behavior) can't trigger a
    # "deque mutated during iteration" RuntimeError mid-read.
    sink.put_text(keys.stdout, "\n".join(out_pump.snapshot()))
    sink.put_text(keys.stderr, "\n".join(err_pump.snapshot()))

    # 4. Sentinel — result.json LAST. API uses this to determine "storage complete".
    sink.put_json(
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
