"""Tests for the generic tool-agnostic wrapper in runner.main.

The wrapper reads MD_* env, spawns the given argv, batches stdout/stderr
lines into /log POSTs, then POSTs /finish with full buffers + base64-encoded
output files.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import os
from pathlib import Path
from unittest.mock import MagicMock

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

    def test_handles_multiple_backend_kwargs_by_merging_each(
        self, mocker: MockerFixture
    ) -> None:
        # Defensive: guidellm CLI accepts repeats; we merge into each occurrence.
        mocker.patch.dict("os.environ", {"OPENAI_API_KEY": "sk-secret"}, clear=False)
        argv = [
            "guidellm",
            "--backend-kwargs={}",
            "--backend-kwargs={\"validate_backend\": false}",
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


@pytest.fixture
def patched_callbacks(mocker: MockerFixture) -> dict[str, MagicMock]:
    """Patch every callback function on runner.main."""
    return {
        "post_state_running": mocker.patch("runner.main.post_state_running"),
        "post_log_batch": mocker.patch("runner.main.post_log_batch"),
        "post_finish": mocker.patch("runner.main.post_finish"),
    }


def test_happy_path_posts_state_running_and_finish_completed(
    patched_callbacks: dict[str, MagicMock],
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
) -> None:
    mocker.patch.dict("os.environ", md_env_minimal, clear=True)
    proc = _fake_proc(stdout=b"hello\n", stderr=b"", returncode=0)
    mocker.patch("runner.main.subprocess.Popen", return_value=proc)

    rc = main_mod.main()

    assert rc == 0
    assert patched_callbacks["post_state_running"].call_count == 1
    sr_kwargs = patched_callbacks["post_state_running"].call_args.kwargs
    assert sr_kwargs["run_id"] == "r-test"
    assert sr_kwargs["token"] == "hmac-test-token"

    assert patched_callbacks["post_finish"].call_count == 1
    finish_kwargs = patched_callbacks["post_finish"].call_args.kwargs
    assert finish_kwargs["state"] == "completed"
    assert finish_kwargs["exit_code"] == 0
    assert finish_kwargs["stdout"] == "hello"
    assert finish_kwargs["stderr"] == ""
    assert finish_kwargs["files"] == {}
    assert finish_kwargs["message"] is None


def test_failure_path_posts_finish_failed_with_message(
    patched_callbacks: dict[str, MagicMock],
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
) -> None:
    mocker.patch.dict("os.environ", md_env_minimal, clear=True)
    proc = _fake_proc(stdout=b"", stderr=b"BOOM\n", returncode=1)
    mocker.patch("runner.main.subprocess.Popen", return_value=proc)

    rc = main_mod.main()

    # Wrapper itself always exits 0 — failure is conveyed via /finish state.
    assert rc == 0
    finish_kwargs = patched_callbacks["post_finish"].call_args.kwargs
    assert finish_kwargs["state"] == "failed"
    assert finish_kwargs["exit_code"] == 1
    assert finish_kwargs["stderr"] == "BOOM"
    assert finish_kwargs["message"] == "tool exited with code 1"


def test_output_file_collected_as_base64(
    patched_callbacks: dict[str, MagicMock],
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
    tmp_path: Path,
) -> None:
    md_env_minimal["MD_OUTPUT_FILES"] = json.dumps({"report": "report.json"})
    mocker.patch.dict("os.environ", md_env_minimal, clear=True)

    # Place the output file in tmp_path and run the wrapper with cwd=tmp_path.
    (tmp_path / "report.json").write_bytes(b"REPORT_BYTES")
    mocker.patch("runner.main.os.getcwd", return_value=str(tmp_path))
    # Path.cwd() is also used to resolve output files.
    mocker.patch("runner.main.Path.cwd", return_value=tmp_path)

    proc = _fake_proc(stdout=b"hello\n", stderr=b"", returncode=0)
    mocker.patch("runner.main.subprocess.Popen", return_value=proc)

    rc = main_mod.main()

    assert rc == 0
    files = patched_callbacks["post_finish"].call_args.kwargs["files"]
    assert "report" in files
    assert files["report"] == base64.b64encode(b"REPORT_BYTES").decode("ascii")


def test_missing_output_file_silently_dropped(
    patched_callbacks: dict[str, MagicMock],
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
    tmp_path: Path,
) -> None:
    md_env_minimal["MD_OUTPUT_FILES"] = json.dumps({"missing": "nope.txt"})
    mocker.patch.dict("os.environ", md_env_minimal, clear=True)
    mocker.patch("runner.main.os.getcwd", return_value=str(tmp_path))
    mocker.patch("runner.main.Path.cwd", return_value=tmp_path)

    proc = _fake_proc(stdout=b"", stderr=b"", returncode=0)
    mocker.patch("runner.main.subprocess.Popen", return_value=proc)

    rc = main_mod.main()

    assert rc == 0
    files = patched_callbacks["post_finish"].call_args.kwargs["files"]
    assert files == {}


def test_log_batches_posted_with_correct_kwargs(
    patched_callbacks: dict[str, MagicMock],
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
) -> None:
    mocker.patch.dict("os.environ", md_env_minimal, clear=True)
    # Several lines so the end-of-stream flush has something to send.
    stdout_blob = b"line one\nline two\nline three\n"
    proc = _fake_proc(stdout=stdout_blob, stderr=b"", returncode=0)
    mocker.patch("runner.main.subprocess.Popen", return_value=proc)

    rc = main_mod.main()

    assert rc == 0
    assert patched_callbacks["post_log_batch"].call_count >= 1

    # All stdout-stream calls should target run_id=r-test and stream=stdout.
    stdout_calls = [
        c
        for c in patched_callbacks["post_log_batch"].call_args_list
        if c.kwargs.get("stream") == "stdout"
    ]
    assert len(stdout_calls) >= 1
    for c in stdout_calls:
        assert c.kwargs["run_id"] == "r-test"
        assert isinstance(c.kwargs["lines"], list)

    # Across all stdout batches we should have observed every line at least once.
    all_lines: list[str] = []
    for c in stdout_calls:
        all_lines.extend(c.kwargs["lines"])
    assert "line one" in all_lines
    assert "line two" in all_lines
    assert "line three" in all_lines

    # And /finish should include the tail stdout (within LOG_TAIL_MAX_BYTES).
    finish_kwargs = patched_callbacks["post_finish"].call_args.kwargs
    assert finish_kwargs["stdout"] == "line one\nline two\nline three"


def test_stdout_tail_caps_at_64kb(
    patched_callbacks: dict[str, MagicMock],
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
) -> None:
    """StreamPump.full is bounded at LOG_TAIL_MAX_BYTES; /finish receives the tail."""
    mocker.patch.dict("os.environ", md_env_minimal, clear=True)
    # Build 200 distinguishable lines (~1 KB each) so we can prove FIFO
    # eviction: the first lines must be dropped, the last must survive.
    lines_in = [f"line-{i:04d}-" + "x" * (1023 - 11) for i in range(200)]
    big = ("\n".join(lines_in) + "\n").encode("utf-8")
    proc = _fake_proc(stdout=big, stderr=b"", returncode=0)
    mocker.patch("runner.main.subprocess.Popen", return_value=proc)

    rc = main_mod.main()

    assert rc == 0
    finish_kwargs = patched_callbacks["post_finish"].call_args.kwargs
    captured = finish_kwargs["stdout"]
    captured_bytes = len(captured.encode("utf-8"))
    # Upper bound: the join produces N-1 newlines, so the on-the-wire
    # bytes are always strictly less than the cap. The +1 accounting in
    # StreamPump charges +1 per line (for the join newline), so once we
    # evict to fit the cap, the actual bytes are ≤ cap - 1.
    assert captured_bytes <= main_mod.LOG_TAIL_MAX_BYTES, (
        f"stdout {captured_bytes} bytes exceeded cap {main_mod.LOG_TAIL_MAX_BYTES}"
    )
    # Lower bound: the buffer should actually be near-full — fed 200 KB,
    # expect the tail to be within 1 KB of the cap (room for the last
    # partial line eviction).
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
    patched_callbacks: dict[str, MagicMock],
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
    caplog: pytest.LogCaptureFixture,
) -> None:
    md_env_minimal["MD_ARGV"] = json.dumps(["guidellm", '--backend-kwargs={"api_key":"sk-secret"}'])
    mocker.patch.dict("os.environ", md_env_minimal, clear=True)
    proc = _fake_proc(stdout=b"", stderr=b"", returncode=0)
    mocker.patch("runner.main.subprocess.Popen", return_value=proc)

    with caplog.at_level("INFO", logger="runner"):
        rc = main_mod.main()

    assert rc == 0
    log_text = "\n".join(r.message for r in caplog.records)
    assert "***REDACTED***" in log_text
    assert "sk-secret" not in log_text


def test_missing_required_env_raises_key_error(
    patched_callbacks: dict[str, MagicMock],
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
) -> None:
    """Config errors before any callback is possible should propagate as KeyError."""
    del md_env_minimal["MD_CALLBACK_URL"]
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


def test_oversized_output_file_skipped_with_warning(
    patched_callbacks: dict[str, MagicMock],
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Output files over OUTPUT_FILE_MAX_BYTES are skipped rather than OOMing."""
    md_env_minimal["MD_OUTPUT_FILES"] = json.dumps({"attack": "attack.bin"})
    mocker.patch.dict("os.environ", md_env_minimal, clear=True)

    # Write a small file but lower the cap to 1 KB so the test stays fast.
    big_file = tmp_path / "attack.bin"
    big_file.write_bytes(b"B" * 2048)  # 2 KB — over the patched 1 KB cap
    mocker.patch("runner.main.os.getcwd", return_value=str(tmp_path))
    mocker.patch("runner.main.Path.cwd", return_value=tmp_path)
    mocker.patch("runner.main.OUTPUT_FILE_MAX_BYTES", 1024)

    proc = _fake_proc(stdout=b"", stderr=b"", returncode=0)
    mocker.patch("runner.main.subprocess.Popen", return_value=proc)

    with caplog.at_level("WARNING", logger="runner"):
        rc = main_mod.main()

    assert rc == 0
    files = patched_callbacks["post_finish"].call_args.kwargs["files"]
    assert "attack" not in files, "oversized file must not appear in /finish files"

    warning_messages = [r.message for r in caplog.records if r.levelno >= logging.WARNING]
    assert any("exceeds" in msg and "attack" in msg for msg in warning_messages), (
        f"expected a warning about 'attack' exceeding cap; got: {warning_messages}"
    )


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
