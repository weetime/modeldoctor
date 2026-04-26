from __future__ import annotations

import pytest

from runner.argv import EnvConfig
from runner.env import MissingEnvError, parse_env


class TestParseEnv:
    def test_minimal_valid_env(self, env_minimal: dict[str, str]) -> None:
        cfg = parse_env(env_minimal)
        assert isinstance(cfg, EnvConfig)
        assert cfg.benchmark_id == "ck-test-id"
        assert cfg.target_url == "http://vllm.test.svc:8000/v1"
        assert cfg.api_type == "chat"
        assert cfg.dataset_name == "random"
        assert cfg.prompt_tokens == 1024
        assert cfg.output_tokens == 128
        assert cfg.request_rate == 0
        assert cfg.total_requests == 1000
        assert cfg.max_duration_seconds == 1800
        assert cfg.dataset_seed is None  # not set in minimal env

    def test_dataset_seed_is_optional(self, env_minimal: dict[str, str]) -> None:
        env_minimal["DATASET_SEED"] = "42"
        cfg = parse_env(env_minimal)
        assert cfg.dataset_seed == 42

    @pytest.mark.parametrize(
        "missing_key",
        [
            "BENCHMARK_ID",
            "CALLBACK_URL",
            "CALLBACK_TOKEN",
            "TARGET_URL",
            "API_KEY",
            "MODEL",
            "API_TYPE",
            "DATASET_NAME",
            "PROMPT_TOKENS",
            "OUTPUT_TOKENS",
            "REQUEST_RATE",
            "TOTAL_REQUESTS",
            "MAX_DURATION_SECONDS",
        ],
    )
    def test_missing_required_var_raises(
        self, env_minimal: dict[str, str], missing_key: str
    ) -> None:
        del env_minimal[missing_key]
        with pytest.raises(MissingEnvError, match=missing_key):
            parse_env(env_minimal)

    def test_rejects_unknown_api_type(self, env_minimal: dict[str, str]) -> None:
        env_minimal["API_TYPE"] = "embeddings"
        with pytest.raises(ValueError, match="API_TYPE"):
            parse_env(env_minimal)

    def test_rejects_unknown_dataset_name(self, env_minimal: dict[str, str]) -> None:
        env_minimal["DATASET_NAME"] = "custom-set"
        with pytest.raises(ValueError, match="DATASET_NAME"):
            parse_env(env_minimal)

    def test_rejects_non_integer_prompt_tokens(self, env_minimal: dict[str, str]) -> None:
        env_minimal["PROMPT_TOKENS"] = "not-a-number"
        with pytest.raises(ValueError, match="PROMPT_TOKENS"):
            parse_env(env_minimal)

    def test_rejects_negative_request_rate(self, env_minimal: dict[str, str]) -> None:
        env_minimal["REQUEST_RATE"] = "-5"
        with pytest.raises(ValueError, match="REQUEST_RATE"):
            parse_env(env_minimal)
