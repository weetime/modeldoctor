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
    # When False, pass `validate_backend: false` to the OpenAI backend so
    # guidellm skips the GET /v1/models probe before benchmarking. Some
    # OpenAI-compatible gateways (e.g. 4pd gen-studio) only expose
    # /v1/chat/completions and 404 on /v1/models — this knob lets the
    # benchmark proceed against them. Default True preserves vanilla
    # guidellm behavior.
    validate_backend: bool
    # HuggingFace tokenizer ID used by guidellm to count tokens for synthetic
    # prompt generation (e.g. "Qwen/Qwen2.5-0.5B-Instruct"). When None,
    # guidellm falls back to loading the tokenizer for `model`, which fails
    # if `model` is a gateway-local name not published on HF
    # (e.g. "gen-studio_…"). Maps to guidellm's --processor flag.
    processor: str | None
    # Max concurrent in-flight requests when request_rate == 0
    # (throughput mode). guidellm 0.5.x requires a rate parameter for
    # ThroughputProfile — it's the concurrency cap, not RPS. Constant /
    # poisson rate modes ignore this. Defaults to 100 in env.py.
    max_concurrency: int


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
    backend_kwargs_dict: dict[str, object] = {"api_key": cfg.api_key}
    if not cfg.validate_backend:
        # guidellm's OpenAIHTTPBackend treats anything truthy as "do validate".
        # False (or empty dict) skips the GET /v1/models probe entirely.
        backend_kwargs_dict["validate_backend"] = False
    backend_kwargs = json.dumps(backend_kwargs_dict, separators=(",", ":"))

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
        # 0 means "no per-second throttle" — push as fast as the target allows
        # but cap at max_concurrency in-flight requests. guidellm 0.5.x
        # ThroughputProfile requires this rate value; earlier versions silently
        # treated it as unlimited.
        argv.append("--rate-type=throughput")
        argv.append(f"--rate={cfg.max_concurrency}")

    # Random dataset: prompt_tokens=N,output_tokens=M synthetic generation.
    data_spec = f"prompt_tokens={cfg.prompt_tokens},output_tokens={cfg.output_tokens}"
    argv.append(f"--data={data_spec}")

    if cfg.dataset_seed is not None:
        argv.append(f"--random-seed={cfg.dataset_seed}")

    # Tokenizer override for synthetic prompt generation. Without this,
    # guidellm tries to load `--model` from HuggingFace, which fails for
    # gateway-local model names. Pass an HF id like "Qwen/Qwen2.5-0.5B-Instruct"
    # that matches the upstream model architecture.
    if cfg.processor:
        argv.append(f"--processor={cfg.processor}")

    return argv
