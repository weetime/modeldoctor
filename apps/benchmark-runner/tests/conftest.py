"""Shared pytest fixtures for the benchmark runner test suite."""

from __future__ import annotations

import json

import pytest


@pytest.fixture
def md_env_minimal() -> dict[str, str]:
    """Minimal valid env for the new generic wrapper.

    Provides MD_* env that the wrapper reads to drive the inner subprocess.
    Tests that need a different argv / output_files override these keys.
    """
    return {
        "MD_RUN_ID": "r-test",
        "MD_CALLBACK_URL": "http://api.test.svc:3001",
        "MD_CALLBACK_TOKEN": "hmac-test-token",
        "MD_ARGV": json.dumps(["echo", "hello"]),
        "MD_OUTPUT_FILES": json.dumps({}),
    }
