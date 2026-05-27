"""Tests for the generic tool-agnostic wrapper in runner.main.

The wrapper reads MD_* env, spawns the given argv, batches stdout/stderr
lines into /log POSTs, then writes meta.json → files → stdout/stderr →
result.json (sentinel) to S3.
"""

from __future__ import annotations

import io
import json
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from pytest_mock import MockerFixture

from runner import main as main_mod


def _fake_proc(
    *,
    stdout: bytes = b"",
    stderr: bytes = b"",
    returncode: int = 0,
) -> MagicMock:
    """Build a Popen-like mock whose stdout/stderr are BytesIO and wait()/returncode behave."""
    proc = MagicMock()
    proc.stdout = io.BytesIO(stdout)
    proc.stderr = io.BytesIO(stderr)
    proc.returncode = returncode
    proc.wait = MagicMock(return_value=returncode)
    return proc


class TestInjectApiKeySentinel:
    """Adapters that pass the key as a CLI flag (evalscope --api-key) emit a
    sentinel so the secret stays out of MD_ARGV; the runner swaps in the real
    OPENAI_API_KEY at exec time.
    """

    SENT = main_mod.OPENAI_API_KEY_SENTINEL

    def test_replaces_sentinel_with_env_key(self, mocker: MockerFixture) -> None:
        mocker.patch.dict("os.environ", {"OPENAI_API_KEY": "sk-secret"}, clear=False)
        argv = ["evalscope", "perf", "--api-key", self.SENT, "--parallel", "8"]
        out = main_mod._inject_api_key_sentinel(argv)
        assert out == ["evalscope", "perf", "--api-key", "sk-secret", "--parallel", "8"]

    def test_no_op_when_no_sentinel(self, mocker: MockerFixture) -> None:
        mocker.patch.dict("os.environ", {"OPENAI_API_KEY": "sk-secret"}, clear=False)
        argv = ["aiperf", "profile", "--tokenizer", "Qwen/Qwen2.5-0.5B-Instruct"]
        assert main_mod._inject_api_key_sentinel(argv) == argv

    def test_empty_string_when_env_unset(self, mocker: MockerFixture) -> None:
        mocker.patch.dict("os.environ", {}, clear=True)
        argv = ["evalscope", "perf", "--api-key", self.SENT]
        assert main_mod._inject_api_key_sentinel(argv) == ["evalscope", "perf", "--api-key", ""]


class TestRedacted:
    """The 'running:' log line must not leak secrets."""

    def test_masks_api_key_value(self) -> None:
        argv = ["evalscope", "perf", "--api-key", "sk-secret", "--parallel", "8"]
        out = main_mod._redacted(argv)
        assert out == ["evalscope", "perf", "--api-key", "***REDACTED***", "--parallel", "8"]
        assert "sk-secret" not in out

    def test_masks_backend_kwargs(self) -> None:
        argv = ["guidellm", '--backend-kwargs={"api_key": "sk-secret"}']
        out = main_mod._redacted(argv)
        assert out == ["guidellm", "--backend-kwargs=***REDACTED***"]


class TestInjectApiKeyIntoBackendKwargs:
    """The wrapper merges OPENAI_API_KEY into any --backend-kwargs= JSON
    so guidellm receives api_key. genai-perf and vegeta don't use this
    flag and so are unaffected.
    """

    def test_no_op_when_no_backend_kwargs_flag(self, mocker: MockerFixture) -> None:
        mocker.patch.dict("os.environ", {"OPENAI_API_KEY": "sk-secret"}, clear=False)
        argv = ["guidellm", "benchmark", "run", "--target=http://x"]
        out = main_mod._inject_api_key_into_backend_kwargs(argv)
        assert out == argv

    def test_no_op_when_env_unset(self, mocker: MockerFixture) -> None:
        mocker.patch.dict("os.environ", {}, clear=True)
        argv = ["guidellm", "--backend-kwargs={}"]
        out = main_mod._inject_api_key_into_backend_kwargs(argv)
        assert out == argv

    def test_merges_into_existing_empty_object(self, mocker: MockerFixture) -> None:
        mocker.patch.dict("os.environ", {"OPENAI_API_KEY": "sk-secret"}, clear=False)
        argv = ["guidellm", "--backend-kwargs={}"]
        out = main_mod._inject_api_key_into_backend_kwargs(argv)
        assert out[0] == "guidellm"
        assert out[1].startswith("--backend-kwargs=")
        merged = json.loads(out[1].removeprefix("--backend-kwargs="))
        assert merged == {"api_key": "sk-secret"}

    def test_merges_into_existing_non_empty_object(self, mocker: MockerFixture) -> None:
        mocker.patch.dict("os.environ", {"OPENAI_API_KEY": "sk-secret"}, clear=False)
        argv = ["guidellm", '--backend-kwargs={"validate_backend": false}']
        out = main_mod._inject_api_key_into_backend_kwargs(argv)
        merged = json.loads(out[1].removeprefix("--backend-kwargs="))
        assert merged == {"validate_backend": False, "api_key": "sk-secret"}

    def test_does_not_overwrite_existing_api_key(self, mocker: MockerFixture) -> None:
        mocker.patch.dict("os.environ", {"OPENAI_API_KEY": "sk-from-env"}, clear=False)
        argv = ["guidellm", '--backend-kwargs={"api_key": "sk-explicit"}']
        out = main_mod._inject_api_key_into_backend_kwargs(argv)
        merged = json.loads(out[1].removeprefix("--backend-kwargs="))
        # If the adapter already supplied api_key, keep it (env is fallback only).
        assert merged == {"api_key": "sk-explicit"}

    def test_handles_multiple_backend_kwargs_by_merging_each(self, mocker: MockerFixture) -> None:
        # Defensive: guidellm CLI accepts repeats; we merge into each occurrence.
        mocker.patch.dict("os.environ", {"OPENAI_API_KEY": "sk-secret"}, clear=False)
        argv = [
            "guidellm",
            "--backend-kwargs={}",
            '--backend-kwargs={"validate_backend": false}',
        ]
        out = main_mod._inject_api_key_into_backend_kwargs(argv)
        first = json.loads(out[1].removeprefix("--backend-kwargs="))
        second = json.loads(out[2].removeprefix("--backend-kwargs="))
        assert first == {"api_key": "sk-secret"}
        assert second == {"validate_backend": False, "api_key": "sk-secret"}

    def test_raises_on_malformed_json(self, mocker: MockerFixture) -> None:
        mocker.patch.dict("os.environ", {"OPENAI_API_KEY": "sk-secret"}, clear=False)
        argv = ["guidellm", "--backend-kwargs={not valid json"]
        with pytest.raises(json.JSONDecodeError):
            main_mod._inject_api_key_into_backend_kwargs(argv)


# ── S3-write order and exit-code propagation ────────────────────────────


def _s3_env(md_env: dict[str, str]) -> dict[str, str]:
    """Merge minimal S3 env vars into an md_env dict."""
    return {
        **md_env,
        "S3_ENDPOINT": "http://localhost:9999",
        "S3_ACCESS_KEY": "k",
        "S3_SECRET_KEY": "s",
        "S3_BUCKET": "b",
        "S3_REGION": "us-east-1",
    }


def test_main_writes_meta_then_result_last(
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
    tmp_path: Path,
) -> None:
    """meta.json is first; result.json is the sentinel written last."""
    mocker.patch.dict("os.environ", _s3_env(md_env_minimal), clear=True)
    mocker.patch("runner.main.Path.cwd", return_value=tmp_path)
    mocker.patch("runner.main.os.getcwd", return_value=str(tmp_path))
    proc = _fake_proc(stdout=b"hello\n", stderr=b"", returncode=0)
    mocker.patch("runner.main.subprocess.Popen", return_value=proc)
    mocker.patch("runner.main.detect_tool_version", return_value=None)

    writer = MagicMock()
    calls: list[tuple[str, str]] = []
    writer.put_json.side_effect = lambda key, _obj: calls.append(("json", key))
    writer.put_text.side_effect = lambda key, _text: calls.append(("text", key))
    writer.put_file.side_effect = lambda key, _path: calls.append(("file", key))

    with patch("runner.main.S3Writer") as MockS3:
        MockS3.from_env.return_value = writer
        rc = main_mod.main()

    assert rc == 0
    # meta.json must be first write of any kind
    assert calls[0] == ("json", "b-test/meta.json")
    # result.json must be the last json call (sentinel)
    json_calls = [c for c in calls if c[0] == "json"]
    assert json_calls[-1] == ("json", "b-test/result.json")


def test_main_propagates_subprocess_exit_code(
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
    tmp_path: Path,
) -> None:
    """main() returns proc.returncode, not always 0."""
    md_env_minimal["MD_ARGV"] = json.dumps(["false"])  # always exits 1
    mocker.patch.dict("os.environ", _s3_env(md_env_minimal), clear=True)
    mocker.patch("runner.main.Path.cwd", return_value=tmp_path)
    mocker.patch("runner.main.os.getcwd", return_value=str(tmp_path))
    mocker.patch("runner.main.detect_tool_version", return_value=None)

    writer = MagicMock()
    with patch("runner.main.S3Writer") as MockS3:
        MockS3.from_env.return_value = writer
        rc = main_mod.main()

    assert rc == 1
    # result.json still written even on failure (watcher needs sentinel)
    keys_written = [call.args[0] for call in writer.put_json.call_args_list]
    assert "b-test/result.json" in keys_written


def test_main_raises_when_s3_put_fails(
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
    tmp_path: Path,
) -> None:
    """S3 write failure propagates as an exception (no try/except swallowing)."""
    mocker.patch.dict("os.environ", _s3_env(md_env_minimal), clear=True)
    mocker.patch("runner.main.Path.cwd", return_value=tmp_path)
    mocker.patch("runner.main.os.getcwd", return_value=str(tmp_path))
    mocker.patch("runner.main.detect_tool_version", return_value=None)

    writer = MagicMock()
    writer.put_json.side_effect = RuntimeError("s3 down")
    with patch("runner.main.S3Writer") as MockS3:
        MockS3.from_env.return_value = writer
        with pytest.raises(RuntimeError, match="s3 down"):
            main_mod.main()


def test_output_file_uploaded_to_s3(
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
    tmp_path: Path,
) -> None:
    """Output files present on disk are uploaded via put_file; absent files are silently skipped."""
    md_env_minimal["MD_OUTPUT_FILES"] = json.dumps({"report": "report.json"})
    mocker.patch.dict("os.environ", _s3_env(md_env_minimal), clear=True)
    (tmp_path / "report.json").write_bytes(b"REPORT_BYTES")
    mocker.patch("runner.main.os.getcwd", return_value=str(tmp_path))
    mocker.patch("runner.main.Path.cwd", return_value=tmp_path)
    proc = _fake_proc(stdout=b"", stderr=b"", returncode=0)
    mocker.patch("runner.main.subprocess.Popen", return_value=proc)
    mocker.patch("runner.main.detect_tool_version", return_value=None)

    writer = MagicMock()
    with patch("runner.main.S3Writer") as MockS3:
        MockS3.from_env.return_value = writer
        rc = main_mod.main()

    assert rc == 0
    # put_file called with correct S3 key
    writer.put_file.assert_called_once_with(
        "b-test/files/report",
        str(tmp_path / "report.json"),
    )
    # result.json files map records relative path
    result_payload = writer.put_json.call_args_list[-1].args[1]
    assert result_payload["files"] == {"report": "files/report"}


def test_missing_output_file_silently_dropped(
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
    tmp_path: Path,
) -> None:
    """Output files that don't exist on disk are silently excluded from files_map."""
    md_env_minimal["MD_OUTPUT_FILES"] = json.dumps({"missing": "nope.txt"})
    mocker.patch.dict("os.environ", _s3_env(md_env_minimal), clear=True)
    mocker.patch("runner.main.os.getcwd", return_value=str(tmp_path))
    mocker.patch("runner.main.Path.cwd", return_value=tmp_path)
    proc = _fake_proc(stdout=b"", stderr=b"", returncode=0)
    mocker.patch("runner.main.subprocess.Popen", return_value=proc)
    mocker.patch("runner.main.detect_tool_version", return_value=None)

    writer = MagicMock()
    with patch("runner.main.S3Writer") as MockS3:
        MockS3.from_env.return_value = writer
        rc = main_mod.main()

    assert rc == 0
    writer.put_file.assert_not_called()
    result_payload = writer.put_json.call_args_list[-1].args[1]
    assert result_payload["files"] == {}


def test_meta_json_contains_tool_version(
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
    tmp_path: Path,
) -> None:
    """meta.json carries the detected tool version."""
    md_env_minimal["MD_ARGV"] = json.dumps(["guidellm", "benchmark", "run"])
    mocker.patch.dict("os.environ", _s3_env(md_env_minimal), clear=True)
    mocker.patch("runner.main.Path.cwd", return_value=tmp_path)
    mocker.patch("runner.main.os.getcwd", return_value=str(tmp_path))
    proc = _fake_proc(stdout=b"", stderr=b"", returncode=0)
    mocker.patch("runner.main.subprocess.Popen", return_value=proc)
    mocker.patch("runner.main.detect_tool_version", return_value="guidellm 0.5.2")

    writer = MagicMock()
    with patch("runner.main.S3Writer") as MockS3:
        MockS3.from_env.return_value = writer
        rc = main_mod.main()

    assert rc == 0
    meta_key, meta_payload = writer.put_json.call_args_list[0].args
    assert meta_key == "b-test/meta.json"
    assert meta_payload["toolVersion"] == "guidellm 0.5.2"
    assert "startTimeIso" in meta_payload


def test_stdout_written_to_s3_with_all_lines(
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
    tmp_path: Path,
) -> None:
    """Tail buffer retains and uploads all lines to S3."""
    mocker.patch.dict("os.environ", _s3_env(md_env_minimal), clear=True)
    mocker.patch("runner.main.Path.cwd", return_value=tmp_path)
    mocker.patch("runner.main.os.getcwd", return_value=str(tmp_path))
    # Several lines so we test that all are retained in the tail.
    stdout_blob = b"line one\nline two\nline three\n"
    proc = _fake_proc(stdout=stdout_blob, stderr=b"", returncode=0)
    mocker.patch("runner.main.subprocess.Popen", return_value=proc)
    mocker.patch("runner.main.detect_tool_version", return_value=None)

    writer = MagicMock()
    with patch("runner.main.S3Writer") as MockS3:
        MockS3.from_env.return_value = writer
        rc = main_mod.main()

    assert rc == 0
    # stdout.log written to S3 should include all lines
    text_calls = {call.args[0]: call.args[1] for call in writer.put_text.call_args_list}
    assert "b-test/stdout.log" in text_calls
    assert "line one" in text_calls["b-test/stdout.log"]
    assert "line two" in text_calls["b-test/stdout.log"]
    assert "line three" in text_calls["b-test/stdout.log"]


def test_subprocess_output_teed_to_pod_log(
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """StreamPump tees the tool's stdout/stderr to the runner's own
    stdout/stderr so the lines land in the K8s pod log for live streaming
    (API pods/log + kubectl logs), not only in the post-mortem S3 objects."""
    mocker.patch.dict("os.environ", _s3_env(md_env_minimal), clear=True)
    mocker.patch("runner.main.Path.cwd", return_value=tmp_path)
    mocker.patch("runner.main.os.getcwd", return_value=str(tmp_path))
    proc = _fake_proc(
        stdout=b"tool-stdout-line\n",
        stderr=b"tool-stderr-line\n",
        returncode=0,
    )
    mocker.patch("runner.main.subprocess.Popen", return_value=proc)
    mocker.patch("runner.main.detect_tool_version", return_value=None)

    writer = MagicMock()
    with patch("runner.main.S3Writer") as MockS3:
        MockS3.from_env.return_value = writer
        rc = main_mod.main()

    assert rc == 0
    captured = capsys.readouterr()
    assert "tool-stdout-line" in captured.out
    assert "tool-stderr-line" in captured.err


def test_streampump_snapshot_returns_buffered_lines() -> None:
    """snapshot() returns a stable copy of the tail buffer (locked read)."""
    pump = main_mod.StreamPump(io.BytesIO(b"a\nb\nc\n"), "stdout", io.StringIO())
    pump.run()
    assert pump.snapshot() == ["a", "b", "c"]


def test_stdout_tail_caps_at_64kb(
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
    tmp_path: Path,
) -> None:
    """StreamPump.full is bounded at LOG_TAIL_MAX_BYTES; stdout.log receives the tail."""
    mocker.patch.dict("os.environ", _s3_env(md_env_minimal), clear=True)
    mocker.patch("runner.main.Path.cwd", return_value=tmp_path)
    mocker.patch("runner.main.os.getcwd", return_value=str(tmp_path))
    # Build 200 distinguishable lines (~1 KB each) so we can prove FIFO
    # eviction: the first lines must be dropped, the last must survive.
    lines_in = [f"line-{i:04d}-" + "x" * (1023 - 11) for i in range(200)]
    big = ("\n".join(lines_in) + "\n").encode("utf-8")
    proc = _fake_proc(stdout=big, stderr=b"", returncode=0)
    mocker.patch("runner.main.subprocess.Popen", return_value=proc)
    mocker.patch("runner.main.detect_tool_version", return_value=None)

    writer = MagicMock()
    captured_stdout: list[str] = []

    def capture_put_text(key: str, text: str) -> None:
        if key.endswith("stdout.log"):
            captured_stdout.append(text)

    writer.put_text.side_effect = capture_put_text

    with patch("runner.main.S3Writer") as MockS3:
        MockS3.from_env.return_value = writer
        rc = main_mod.main()

    assert rc == 0
    assert len(captured_stdout) == 1
    captured = captured_stdout[0]
    captured_bytes = len(captured.encode("utf-8"))
    # Upper bound: within the cap
    assert captured_bytes <= main_mod.LOG_TAIL_MAX_BYTES, (
        f"stdout {captured_bytes} bytes exceeded cap {main_mod.LOG_TAIL_MAX_BYTES}"
    )
    # Lower bound: near-full
    assert captured_bytes >= main_mod.LOG_TAIL_MAX_BYTES - 1024, (
        f"stdout {captured_bytes} bytes is suspiciously below cap {main_mod.LOG_TAIL_MAX_BYTES}"
    )

    captured_lines = captured.split("\n")

    # Tail semantics: the very last input line must be present.
    assert captured_lines[-1] == lines_in[-1], "last input line should be preserved"

    # FIFO eviction: the very first input line must be evicted.
    assert "line-0000" not in captured, "first input line should have been evicted from tail"

    # Sanity: many lines were dropped overall.
    assert len(captured_lines) < 200, "tail should have evicted most lines"


def test_redaction_in_log_line(
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    md_env_minimal["MD_ARGV"] = json.dumps(["guidellm", '--backend-kwargs={"api_key":"sk-secret"}'])
    mocker.patch.dict("os.environ", _s3_env(md_env_minimal), clear=True)
    mocker.patch("runner.main.Path.cwd", return_value=tmp_path)
    mocker.patch("runner.main.os.getcwd", return_value=str(tmp_path))
    proc = _fake_proc(stdout=b"", stderr=b"", returncode=0)
    mocker.patch("runner.main.subprocess.Popen", return_value=proc)
    mocker.patch("runner.main.detect_tool_version", return_value=None)

    writer = MagicMock()
    with patch("runner.main.S3Writer") as MockS3:
        MockS3.from_env.return_value = writer
        with caplog.at_level("INFO", logger="runner"):
            rc = main_mod.main()

    assert rc == 0
    log_text = "\n".join(r.message for r in caplog.records)
    assert "***REDACTED***" in log_text
    assert "sk-secret" not in log_text


def test_injected_api_key_is_redacted_in_log(
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
    tmp_path: Path,
    caplog,
) -> None:
    """End-to-end: env-set OPENAI_API_KEY merges into --backend-kwargs at
    exec time, but the resulting argv is still masked in the runner log
    line so the secret never appears in stdout/captured pod logs."""
    md_env_minimal["MD_ARGV"] = json.dumps(["guidellm", "--backend-kwargs={}"])
    md_env_minimal["OPENAI_API_KEY"] = "sk-from-env-secret"
    mocker.patch.dict("os.environ", _s3_env(md_env_minimal), clear=True)
    mocker.patch("runner.main.Path.cwd", return_value=tmp_path)
    mocker.patch("runner.main.os.getcwd", return_value=str(tmp_path))
    proc = _fake_proc(stdout=b"", stderr=b"", returncode=0)
    mocker.patch("runner.main.subprocess.Popen", return_value=proc)
    mocker.patch("runner.main.detect_tool_version", return_value=None)

    writer = MagicMock()
    with patch("runner.main.S3Writer") as MockS3:
        MockS3.from_env.return_value = writer
        with caplog.at_level("INFO", logger="runner"):
            main_mod.main()

    log_text = "\n".join(r.message for r in caplog.records)
    assert "***REDACTED***" in log_text
    assert "sk-from-env-secret" not in log_text


def test_missing_required_env_raises_key_error(
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
) -> None:
    """Config errors should propagate as KeyError."""
    del md_env_minimal["MD_BENCHMARK_ID"]
    mocker.patch.dict("os.environ", md_env_minimal, clear=True)
    # Popen should never be reached.
    popen = mocker.patch("runner.main.subprocess.Popen")

    with pytest.raises(KeyError):
        main_mod.main()

    popen.assert_not_called()


def test_redacted_helper_passes_through_non_secret_args() -> None:
    argv = ["guidellm", "--target=http://x", "--rate-type=constant"]
    assert main_mod._redacted(argv) == argv


def test_redacted_helper_redacts_backend_kwargs() -> None:
    argv = ["guidellm", '--backend-kwargs={"api_key":"sk-zzz"}']
    out = main_mod._redacted(argv)
    assert out[0] == "guidellm"
    assert out[1] == "--backend-kwargs=***REDACTED***"


def test_materialize_input_files_symlinks_into_cwd(
    mocker: MockerFixture,
    tmp_path: Path,
) -> None:
    """When MD_INPUT_FILE_PATHS is set, the wrapper symlinks mount paths into cwd."""
    src = tmp_path / "external" / "ds.json"
    src.parent.mkdir()
    src.write_text("{}")
    cwd = tmp_path / "work"
    cwd.mkdir()

    mocker.patch.dict(
        "os.environ",
        {"MD_INPUT_FILE_PATHS": json.dumps({"dataset.json": str(src)})},
        clear=True,
    )
    mocker.patch("runner.main.Path.cwd", return_value=cwd)

    main_mod._materialize_input_files()

    dst = cwd / "dataset.json"
    assert dst.is_symlink()
    assert os.readlink(dst) == str(src)


# ── detect_tool_version ─────────────────────────────────────────────────


def _fake_completed(*, stdout: str = "", stderr: str = "", returncode: int = 0) -> MagicMock:
    cp = MagicMock()
    cp.stdout = stdout
    cp.stderr = stderr
    cp.returncode = returncode
    return cp


class TestDetectToolVersion:
    def test_returns_first_stripped_line_of_stdout(self, mocker: MockerFixture) -> None:
        mocker.patch(
            "runner.main.subprocess.run",
            return_value=_fake_completed(stdout="guidellm 0.5.2\n(c) gpustack\n"),
        )
        assert main_mod.detect_tool_version("guidellm") == "guidellm 0.5.2"

    def test_falls_back_to_stderr_when_stdout_empty(self, mocker: MockerFixture) -> None:
        # vegeta prints --version to stderr in some builds.
        mocker.patch(
            "runner.main.subprocess.run",
            return_value=_fake_completed(stdout="", stderr="vegeta 12.10.0\n"),
        )
        assert main_mod.detect_tool_version("vegeta") == "vegeta 12.10.0"

    def test_returns_none_when_binary_missing(self, mocker: MockerFixture) -> None:
        mocker.patch("runner.main.subprocess.run", side_effect=FileNotFoundError())
        assert main_mod.detect_tool_version("nonexistent-tool") is None

    def test_returns_none_on_timeout(self, mocker: MockerFixture) -> None:
        import subprocess as _sp

        mocker.patch(
            "runner.main.subprocess.run",
            side_effect=_sp.TimeoutExpired(cmd=["foo"], timeout=10),
        )
        assert main_mod.detect_tool_version("foo") is None

    def test_returns_none_on_nonzero_returncode(self, mocker: MockerFixture) -> None:
        mocker.patch(
            "runner.main.subprocess.run",
            return_value=_fake_completed(stdout="usage: foo [...]\n", returncode=2),
        )
        assert main_mod.detect_tool_version("foo") is None

    def test_returns_none_on_blank_output(self, mocker: MockerFixture) -> None:
        mocker.patch(
            "runner.main.subprocess.run",
            return_value=_fake_completed(stdout="   \n", returncode=0),
        )
        assert main_mod.detect_tool_version("foo") is None

    def test_truncates_to_50_chars(self, mocker: MockerFixture) -> None:
        # Contract caps toolVersion at 50; the helper must truncate so
        # validation doesn't reject a verbose banner.
        long = "guidellm " + "x" * 200
        mocker.patch(
            "runner.main.subprocess.run",
            return_value=_fake_completed(stdout=long + "\n"),
        )
        out = main_mod.detect_tool_version("guidellm")
        assert out is not None
        assert len(out) == main_mod.TOOL_VERSION_MAX_CHARS
