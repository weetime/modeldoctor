from __future__ import annotations

from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

from runner import main as main_mod

FIXTURE = Path(__file__).parent / "fixtures" / "guidellm_report.json"


@pytest.fixture
def patched(mocker: MockerFixture, tmp_path: Path) -> dict[str, MagicMock]:
    """Patch every external surface (subprocess, callback HTTP, output file)."""

    # subprocess.run returns success and writes the fixture into the output path.
    def fake_run(argv: list[str], **_kwargs: object) -> CompletedProcess[bytes]:
        # Find the --output-path=X arg and copy the fixture there.
        for a in argv:
            if a.startswith("--output-path="):
                out = a.split("=", 1)[1]
                Path(out).write_text(FIXTURE.read_text())
        return CompletedProcess(argv, 0, stdout=b"guidellm log\n", stderr=b"")

    return {
        "run": mocker.patch("runner.main.subprocess.run", side_effect=fake_run),
        "post_state": mocker.patch("runner.main.post_state"),
        "post_metrics": mocker.patch("runner.main.post_metrics"),
        "tmp_dir": tmp_path,
    }


def test_main_happy_path_posts_running_completed_and_metrics(
    patched: dict[str, MagicMock], env_minimal: dict[str, str], mocker: MockerFixture
) -> None:
    mocker.patch.dict("os.environ", env_minimal, clear=True)
    # Redirect /tmp/report.json to a tmp_path so tests are isolated.
    mocker.patch("runner.main._OUTPUT_PATH", str(patched["tmp_dir"] / "report.json"))

    rc = main_mod.main()
    assert rc == 0

    # state callbacks: running first, then completed
    state_calls = patched["post_state"].call_args_list
    assert state_calls[0].kwargs["state"] == "running"
    assert state_calls[-1].kwargs["state"] == "completed"

    # metrics call: exactly one
    assert patched["post_metrics"].call_count == 1
    metrics_kwargs = patched["post_metrics"].call_args.kwargs
    assert "metricsSummary" not in metrics_kwargs  # passed as 'summary' kwarg
    assert metrics_kwargs["summary"]["ttft"]["mean"] == 120
    assert metrics_kwargs["raw"]["benchmarks"][0]["metrics"]["request_totals"]["total"] == 1000


def test_main_failure_posts_failed_with_stderr_tail(
    mocker: MockerFixture, env_minimal: dict[str, str]
) -> None:
    mocker.patch.dict("os.environ", env_minimal, clear=True)
    mocker.patch(
        "runner.main.subprocess.run",
        return_value=CompletedProcess([], 1, stdout=b"x" * 200, stderr=b"BOOM" * 50),
    )
    post_state = mocker.patch("runner.main.post_state")
    post_metrics = mocker.patch("runner.main.post_metrics")

    rc = main_mod.main()
    assert rc == 1

    # First state call: running. Final state call: failed with stderr tail.
    assert post_state.call_args_list[0].kwargs["state"] == "running"
    final = post_state.call_args_list[-1]
    assert final.kwargs["state"] == "failed"
    assert "BOOM" in final.kwargs["message"]

    # No metrics callback when guidellm exits non-zero.
    assert post_metrics.call_count == 0


def test_main_caps_stdout_logs_at_stdout_tail_bytes(
    patched: dict[str, MagicMock], env_minimal: dict[str, str], mocker: MockerFixture
) -> None:
    # Override the happy-path fake_run to also produce a 1 MB stdout blob.
    big = b"x" * (1024 * 1024)

    def fake_run_with_big_stdout(argv: list[str], **_: object) -> CompletedProcess[bytes]:
        for a in argv:
            if a.startswith("--output-path="):
                Path(a.split("=", 1)[1]).write_text(FIXTURE.read_text())
        return CompletedProcess(argv, 0, stdout=big, stderr=b"")

    patched["run"].side_effect = fake_run_with_big_stdout
    mocker.patch.dict("os.environ", env_minimal, clear=True)
    mocker.patch("runner.main._OUTPUT_PATH", str(patched["tmp_dir"] / "report.json"))

    rc = main_mod.main()
    assert rc == 0

    metrics_kwargs = patched["post_metrics"].call_args.kwargs
    # logs payload is capped at _STDOUT_TAIL_BYTES (16 KB), not the full 1 MB.
    assert metrics_kwargs["logs"] is not None
    assert len(metrics_kwargs["logs"].encode("utf-8")) <= main_mod._STDOUT_TAIL_BYTES


def test_main_missing_env_exits_with_error(
    mocker: MockerFixture, env_minimal: dict[str, str]
) -> None:
    del env_minimal["TARGET_URL"]
    mocker.patch.dict("os.environ", env_minimal, clear=True)
    post_state = mocker.patch("runner.main.post_state")
    mocker.patch("runner.main.subprocess.run")  # should never be called

    rc = main_mod.main()
    assert rc == 1
    # Cannot post state without callback URL, but env_minimal still has it.
    # The runner should have posted state=failed with a useful message.
    failed = post_state.call_args_list
    assert any(c.kwargs.get("state") == "failed" for c in failed)
