"""Tests for the v2 callback HTTP client (api/internal/benchmarks/<id>/log)."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

from runner.callback import post_log_batch


@pytest.fixture
def fake_post(mocker: MockerFixture) -> MagicMock:
    mock = mocker.patch("runner.callback.requests.post")
    mock.return_value = MagicMock(status_code=200, ok=True)
    return mock


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
