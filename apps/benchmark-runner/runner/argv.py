"""Build the ``benchmark-runner benchmark run ...`` argv from a parsed env.

Targets the gpustack/benchmark-runner image (an extension of guidellm
with the same CLI surface plus an ``--progress-url`` callback hook).

Pure function so it's easy to unit test. The env-parsing layer
(``runner.env``) is responsible for type coercion and required-field
validation; this module assumes a well-typed ``EnvConfig``.
"""

from __future__ import annotations

import json
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
    """Translate a parsed env into the ``benchmark-runner benchmark run ...`` argv.

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

    # The OpenAIHTTPBackend reads `api_key` from --backend-kwargs JSON and
    # turns it into the Authorization Bearer header. We don't have a less
    # leak-prone channel — guidellm doesn't read OPENAI_API_KEY from env —
    # so the orchestrator (runner.main) must redact this argv element before
    # logging it.
    backend_kwargs = json.dumps({"api_key": cfg.api_key}, separators=(",", ":"))

    argv: list[str] = [
        "benchmark-runner",
        "benchmark",
        "run",
        # OpenAI-compatible HTTP backend covers vLLM and most other servers.
        "--backend=openai_http",
        f"--backend-kwargs={backend_kwargs}",
        f"--target={cfg.target_url}",
        f"--model={cfg.model}",
        f"--max-requests={cfg.total_requests}",
        f"--max-seconds={cfg.max_duration_seconds}",
        f"--output-path={output_path}",
        # Headless: no interactive progress bar in a container. The state
        # callbacks (post_state) carry lifecycle; rawMetrics has the rest.
        "--disable-console",
    ]

    if cfg.request_rate > 0:
        argv.append("--rate-type=constant")
        argv.append(f"--rate={cfg.request_rate}")
    else:
        # 0 means unlimited — let the runner push as fast as the target allows.
        argv.append("--rate-type=throughput")

    # Random dataset: prompt_tokens=N,output_tokens=M synthetic generation.
    data_spec = f"prompt_tokens={cfg.prompt_tokens},output_tokens={cfg.output_tokens}"
    argv.append(f"--data={data_spec}")

    if cfg.dataset_seed is not None:
        argv.append(f"--random-seed={cfg.dataset_seed}")

    return argv
