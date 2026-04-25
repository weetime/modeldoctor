"""Build the `guidellm benchmark ...` argv from a parsed env config.

Pure function so it's easy to unit test. The env-parsing layer
(``runner.env``) is responsible for type coercion and required-field
validation; this module assumes a well-typed ``EnvConfig``.
"""

from __future__ import annotations

from typing import Literal, NamedTuple


class EnvConfig(NamedTuple):
    """Parsed env vars in their typed form. Built by ``runner.env``."""

    benchmark_id: str
    callback_url: str
    callback_token: str
    target_url: str
    api_key: str
    model: str
    api_type: Literal["chat", "completion"]
    dataset_name: Literal["random", "sharegpt"]
    prompt_tokens: int
    output_tokens: int
    dataset_seed: int | None
    request_rate: int
    total_requests: int
    max_duration_seconds: int


def build_guidellm_argv(cfg: EnvConfig, *, output_path: str) -> list[str]:
    """Translate a parsed env into the ``guidellm benchmark ...`` argv.

    Raises:
        NotImplementedError: if ``dataset_name == "sharegpt"`` — ShareGPT is
            deferred to Phase 6, and the controller will normally reject the
            request before it reaches the runner. This guard exists so a
            mis-routed request fails loud.
    """
    if cfg.dataset_name == "sharegpt":
        raise NotImplementedError(
            "sharegpt dataset is not supported until Phase 6; "
            "the controller should have rejected this request",
        )

    argv: list[str] = [
        "guidellm",
        "benchmark",
        f"--target={cfg.target_url}",
        f"--model={cfg.model}",
        f"--max-requests={cfg.total_requests}",
        f"--max-seconds={cfg.max_duration_seconds}",
        f"--output-path={output_path}",
    ]

    if cfg.request_rate > 0:
        argv.append("--rate-type=constant")
        argv.append(f"--rate={cfg.request_rate}")
    else:
        # 0 means unlimited — let guidellm push as fast as the target allows.
        argv.append("--rate-type=throughput")

    # Random dataset: prompt_tokens=N,output_tokens=M synthetic generation.
    data_spec = f"prompt_tokens={cfg.prompt_tokens},output_tokens={cfg.output_tokens}"
    argv.append(f"--data={data_spec}")

    if cfg.dataset_seed is not None:
        argv.append(f"--random-seed={cfg.dataset_seed}")

    return argv
