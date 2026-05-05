"""Tests for the v2 callback HTTP client (api/internal/benchmarks/<id>/{state,log,finish})."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

from runner.callback import post_finish, post_log_batch, post_state_running


@pytest.fixture
def fake_post(mocker: MockerFixture) -> MagicMock:
    mock = mocker.patch("runner.callback.requests.post")
    mock.return_value = MagicMock(status_code=200, ok=True)
    return mock


class TestPostStateRunning:
    def test_url_path_includes_benchmark_id(self, fake_post: MagicMock) -> None:
        post_state_running(callback_url="http://api:3001", token="t", benchmark_id="b-xyz")
        url = fake_post.call_args.args[0]
        assert url == "http://api:3001/api/internal/benchmarks/b-xyz/state"

    def test_url_normalizes_trailing_slash(self, fake_post: MagicMock) -> None:
        post_state_running(callback_url="http://api:3001/", token="t", benchmark_id="b-xyz")
        url = fake_post.call_args.args[0]
        assert url == "http://api:3001/api/internal/benchmarks/b-xyz/state"

    def test_url_no_double_slash(self, fake_post: MagicMock) -> None:
        post_state_running(callback_url="http://api:3001", token="t", benchmark_id="b-xyz")
        url = fake_post.call_args.args[0]
        # No double slash anywhere after the scheme.
        assert "://" in url
        assert "//" not in url.split("://", 1)[1]

    def test_authorization_header_is_bearer(self, fake_post: MagicMock) -> None:
        post_state_running(callback_url="http://api:3001", token="hmac-token", benchmark_id="b")
        headers = fake_post.call_args.kwargs["headers"]
        assert headers["Authorization"] == "Bearer hmac-token"

    def test_body_is_state_running_when_no_tool_version(self, fake_post: MagicMock) -> None:
        post_state_running(callback_url="http://api:3001", token="t", benchmark_id="b")
        assert fake_post.call_args.kwargs["json"] == {"state": "running"}

    def test_body_includes_tool_version_when_provided(self, fake_post: MagicMock) -> None:
        # The scenario this test guards: the runner detects guidellm 0.5.2
        # at boot via `guidellm --version` and the BFF must persist it.
        post_state_running(
            callback_url="http://api:3001",
            token="t",
            benchmark_id="b",
            tool_version="guidellm 0.5.2",
        )
        body = fake_post.call_args.kwargs["json"]
        assert body == {"state": "running", "toolVersion": "guidellm 0.5.2"}

    def test_body_omits_tool_version_when_explicit_none(self, fake_post: MagicMock) -> None:
        # tool_version=None must be omitted from the body so older BFFs that
        # don't accept the field still succeed (forward-compat hedge).
        post_state_running(
            callback_url="http://api:3001",
            token="t",
            benchmark_id="b",
            tool_version=None,
        )
        body = fake_post.call_args.kwargs["json"]
        assert "toolVersion" not in body
        assert body == {"state": "running"}

    def test_raises_on_non_2xx(self, mocker: MockerFixture) -> None:
        mock = mocker.patch("runner.callback.requests.post")
        mock.return_value = MagicMock(status_code=500, ok=False, text="boom")
        with pytest.raises(RuntimeError, match="500"):
            post_state_running(callback_url="http://api:3001", token="t", benchmark_id="b")


class TestPostLogBatch:
    def test_url_path_is_log(self, fake_post: MagicMock) -> None:
        post_log_batch(
            callback_url="http://api:3001",
            token="t",
            benchmark_id="b-xyz",
            stream="stdout",
            lines=["a", "b"],
        )
        url = fake_post.call_args.args[0]
        assert url == "http://api:3001/api/internal/benchmarks/b-xyz/log"

    def test_body_carries_stream_and_lines(self, fake_post: MagicMock) -> None:
        post_log_batch(
            callback_url="http://api:3001",
            token="t",
            benchmark_id="b",
            stream="stderr",
            lines=["line1", "line2"],
        )
        body = fake_post.call_args.kwargs["json"]
        assert body == {"stream": "stderr", "lines": ["line1", "line2"]}

    def test_authorization_header(self, fake_post: MagicMock) -> None:
        post_log_batch(
            callback_url="http://api:3001",
            token="hmac-token",
            benchmark_id="b",
            stream="stdout",
            lines=[],
        )
        assert fake_post.call_args.kwargs["headers"]["Authorization"] == "Bearer hmac-token"


class TestPostFinish:
    def test_url_path_is_finish(self, fake_post: MagicMock) -> None:
        post_finish(
            callback_url="http://api:3001",
            token="t",
            benchmark_id="b-xyz",
            state="completed",
            exit_code=0,
            stdout="ok",
            stderr="",
            files={},
            message=None,
        )
        url = fake_post.call_args.args[0]
        assert url == "http://api:3001/api/internal/benchmarks/b-xyz/finish"

    def test_body_contains_assembled_payload(self, fake_post: MagicMock) -> None:
        post_finish(
            callback_url="http://api:3001",
            token="t",
            benchmark_id="b",
            state="completed",
            exit_code=0,
            stdout="hello",
            stderr="",
            files={"report": "QkFTRTY0"},
            message=None,
        )
        body = fake_post.call_args.kwargs["json"]
        assert body == {
            "state": "completed",
            "exitCode": 0,
            "stdout": "hello",
            "stderr": "",
            "files": {"report": "QkFTRTY0"},
        }
        assert "message" not in body

    def test_body_includes_message_when_set(self, fake_post: MagicMock) -> None:
        post_finish(
            callback_url="http://api:3001",
            token="t",
            benchmark_id="b",
            state="failed",
            exit_code=1,
            stdout="",
            stderr="oh no",
            files={},
            message="tool exited with code 1",
        )
        body = fake_post.call_args.kwargs["json"]
        assert body["state"] == "failed"
        assert body["exitCode"] == 1
        assert body["stderr"] == "oh no"
        assert body["message"] == "tool exited with code 1"

    def test_url_normalizes_trailing_slash(self, fake_post: MagicMock) -> None:
        post_finish(
            callback_url="http://api:3001/",
            token="t",
            benchmark_id="b",
            state="completed",
            exit_code=0,
            stdout="",
            stderr="",
            files={},
            message=None,
        )
        url = fake_post.call_args.args[0]
        assert url == "http://api:3001/api/internal/benchmarks/b/finish"

    def test_raises_on_non_2xx(self, mocker: MockerFixture) -> None:
        mock = mocker.patch("runner.callback.requests.post")
        mock.return_value = MagicMock(status_code=502, ok=False, text="bad gateway")
        with pytest.raises(RuntimeError, match="502"):
            post_finish(
                callback_url="http://api:3001",
                token="t",
                benchmark_id="b",
                state="completed",
                exit_code=0,
                stdout="",
                stderr="",
                files={},
                message=None,
            )
