"""Parse the env-var contract into a typed ``EnvConfig``."""

from __future__ import annotations

from typing import Literal, get_args

from runner.argv import EnvConfig

ApiType = Literal["chat", "completion"]
DatasetName = Literal["random", "sharegpt"]


class MissingEnvError(Exception):
    """Raised when a required env var is absent."""


def _required(env: dict[str, str], key: str) -> str:
    if key not in env or env[key] == "":
        raise MissingEnvError(f"Missing required env var: {key}")
    return env[key]


def _required_int(env: dict[str, str], key: str, *, min_value: int | None = None) -> int:
    raw = _required(env, key)
    try:
        value = int(raw)
    except ValueError as e:
        raise ValueError(f"{key} must be an integer, got {raw!r}") from e
    if min_value is not None and value < min_value:
        raise ValueError(f"{key} must be >= {min_value}, got {value}")
    return value


def _optional_int(env: dict[str, str], key: str) -> int | None:
    if key not in env or env[key] == "":
        return None
    raw = env[key]
    try:
        return int(raw)
    except ValueError as e:
        raise ValueError(f"{key} must be an integer if set, got {raw!r}") from e


def _literal(env: dict[str, str], key: str, allowed: tuple[str, ...]) -> str:
    raw = _required(env, key)
    if raw not in allowed:
        raise ValueError(f"{key} must be one of {allowed}, got {raw!r}")
    return raw


def parse_env(env: dict[str, str]) -> EnvConfig:
    """Parse env into a typed config; raise on missing or malformed fields."""
    return EnvConfig(
        benchmark_id=_required(env, "BENCHMARK_ID"),
        callback_url=_required(env, "CALLBACK_URL"),
        callback_token=_required(env, "CALLBACK_TOKEN"),
        target_url=_required(env, "TARGET_URL"),
        api_key=_required(env, "API_KEY"),
        model=_required(env, "MODEL"),
        api_type=_literal(env, "API_TYPE", get_args(ApiType)),  # type: ignore[arg-type]
        dataset_name=_literal(env, "DATASET_NAME", get_args(DatasetName)),  # type: ignore[arg-type]
        prompt_tokens=_required_int(env, "PROMPT_TOKENS", min_value=1),
        output_tokens=_required_int(env, "OUTPUT_TOKENS", min_value=1),
        dataset_seed=_optional_int(env, "DATASET_SEED"),
        request_rate=_required_int(env, "REQUEST_RATE", min_value=0),
        total_requests=_required_int(env, "TOTAL_REQUESTS", min_value=1),
        max_duration_seconds=_required_int(env, "MAX_DURATION_SECONDS", min_value=1),
    )
