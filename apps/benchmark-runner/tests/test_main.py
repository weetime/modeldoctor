"""Tests for the generic tool-agnostic wrapper in runner.main.

The wrapper reads MD_* env, spawns the given argv, batches stdout/stderr
lines into /log POSTs, then POSTs /finish with full buffers + base64-encoded
output files.
"""

from __future__ import annotations

import base64
import io
import json
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
        c for c in patched_callbacks["post_log_batch"].call_args_list
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

    # And /finish should include the full uncapped stdout (no _STDOUT_TAIL_BYTES cap).
    finish_kwargs = patched_callbacks["post_finish"].call_args.kwargs
    assert finish_kwargs["stdout"] == "line one\nline two\nline three"


def test_full_stdout_is_uncapped_on_finish(
    patched_callbacks: dict[str, MagicMock],
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
) -> None:
    """The new wrapper does NOT cap stdout/stderr; full buffers ship on /finish."""
    mocker.patch.dict("os.environ", md_env_minimal, clear=True)
    # 100 KB of stdout — well beyond the legacy 16 KB cap.
    big = (b"x" * 1023 + b"\n") * 100
    proc = _fake_proc(stdout=big, stderr=b"", returncode=0)
    mocker.patch("runner.main.subprocess.Popen", return_value=proc)

    rc = main_mod.main()

    assert rc == 0
    finish_kwargs = patched_callbacks["post_finish"].call_args.kwargs
    # The pump strips trailing \n per line and joins with \n, so length is
    # very close to the input but not a perfect equality. Crucially: well
    # over 16 KB.
    assert len(finish_kwargs["stdout"].encode("utf-8")) > 16 * 1024


def test_redaction_in_log_line(
    patched_callbacks: dict[str, MagicMock],
    md_env_minimal: dict[str, str],
    mocker: MockerFixture,
    caplog: pytest.LogCaptureFixture,
) -> None:
    md_env_minimal["MD_ARGV"] = json.dumps(
        ["guidellm", '--backend-kwargs={"api_key":"sk-secret"}']
    )
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
