"""Shared pytest fixtures for the benchmark runner test suite."""
from __future__ import annotations

import pytest


@pytest.fixture
def env_minimal() -> dict[str, str]:
    """A minimal valid env dict — every required field present, defaults elsewhere."""
    return {
        "BENCHMARK_ID": "ck-test-id",
        "CALLBACK_URL": "http://api.test.svc:3001",
        "CALLBACK_TOKEN": "hmac-test-token",
        "TARGET_URL": "http://vllm.test.svc:8000/v1",
        "API_KEY": "sk-test",
        "MODEL": "facebook/opt-125m",
        "API_TYPE": "chat",
        "DATASET_NAME": "random",
        "PROMPT_TOKENS": "1024",
        "OUTPUT_TOKENS": "128",
        "REQUEST_RATE": "0",
        "TOTAL_REQUESTS": "1000",
        "MAX_DURATION_SECONDS": "1800",
    }
