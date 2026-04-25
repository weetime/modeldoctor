from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

from runner.callback import post_metrics, post_state


@pytest.fixture
def fake_post(mocker: MockerFixture) -> MagicMock:
    mock = mocker.patch("runner.callback.requests.post")
    mock.return_value = MagicMock(status_code=200, ok=True)
    return mock


class TestPostState:
    def test_url_path_includes_benchmark_id(self, fake_post: MagicMock) -> None:
        post_state(
            callback_url="http://api:3001",
            token="t",
            benchmark_id="ck-xyz",
            state="running",
        )
        url = fake_post.call_args.args[0]
        assert url == "http://api:3001/api/internal/benchmarks/ck-xyz/state"

    def test_authorization_header_is_bearer(self, fake_post: MagicMock) -> None:
        post_state(
            callback_url="http://api:3001",
            token="hmac-token",
            benchmark_id="ck",
            state="running",
        )
        headers = fake_post.call_args.kwargs["headers"]
        assert headers["Authorization"] == "Bearer hmac-token"

    def test_minimal_body_only_has_state(self, fake_post: MagicMock) -> None:
        post_state(
            callback_url="http://api:3001",
            token="t",
            benchmark_id="ck",
            state="running",
        )
        body = fake_post.call_args.kwargs["json"]
        assert body == {"state": "running"}

    def test_body_includes_message_and_progress_when_set(self, fake_post: MagicMock) -> None:
        post_state(
            callback_url="http://api:3001",
            token="t",
            benchmark_id="ck",
            state="failed",
            message="boom",
            progress=0.5,
        )
        body = fake_post.call_args.kwargs["json"]
        assert body == {"state": "failed", "stateMessage": "boom", "progress": 0.5}

    def test_raises_on_non_2xx(self, mocker: MockerFixture) -> None:
        mock = mocker.patch("runner.callback.requests.post")
        mock.return_value = MagicMock(status_code=500, ok=False, text="boom")
        with pytest.raises(RuntimeError, match="500"):
            post_state(
                callback_url="http://api:3001",
                token="t",
                benchmark_id="ck",
                state="running",
            )


class TestPostMetrics:
    def test_url_path_is_metrics(self, fake_post: MagicMock) -> None:
        post_metrics(
            callback_url="http://api:3001",
            token="t",
            benchmark_id="ck-xyz",
            summary={"ttft": {"mean": 1.0, "p50": 1.0, "p95": 1.0, "p99": 1.0}},
            raw={"any": "thing"},
            logs=None,
        )
        url = fake_post.call_args.args[0]
        assert url == "http://api:3001/api/internal/benchmarks/ck-xyz/metrics"

    def test_body_carries_summary_raw_logs(self, fake_post: MagicMock) -> None:
        post_metrics(
            callback_url="http://api:3001",
            token="t",
            benchmark_id="ck",
            summary={"k": "v"},
            raw={"r": 1},
            logs="some logs",
        )
        body = fake_post.call_args.kwargs["json"]
        assert body["metricsSummary"] == {"k": "v"}
        assert body["rawMetrics"] == {"r": 1}
        assert body["logs"] == "some logs"

    def test_logs_omitted_when_none(self, fake_post: MagicMock) -> None:
        post_metrics(
            callback_url="http://api:3001",
            token="t",
            benchmark_id="ck",
            summary={"k": "v"},
            raw={"r": 1},
            logs=None,
        )
        body = fake_post.call_args.kwargs["json"]
        assert "logs" not in body
