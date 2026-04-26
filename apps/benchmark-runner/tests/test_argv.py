from __future__ import annotations

import pytest

from runner.argv import EnvConfig, build_guidellm_argv


def _config(**overrides: object) -> EnvConfig:
    base = EnvConfig(
        benchmark_id="ck-test",
        callback_url="http://api:3001",
        callback_token="t",
        target_url="http://vllm:8000/v1",
        api_key="sk-test",
        model="facebook/opt-125m",
        api_type="chat",
        dataset_name="random",
        prompt_tokens=1024,
        output_tokens=128,
        dataset_seed=None,
        request_rate=0,
        total_requests=1000,
        max_duration_seconds=1800,
    )
    return base._replace(**overrides)  # type: ignore[arg-type]


class TestBuildGuidellmArgv:
    def test_throughput_when_rate_is_zero(self) -> None:
        argv = build_guidellm_argv(_config(request_rate=0), output_path="/tmp/r.json")
        assert "--rate-type=throughput" in argv
        assert "--rate=0" not in argv
        assert not any(a.startswith("--rate=") for a in argv)

    def test_constant_when_rate_is_positive(self) -> None:
        argv = build_guidellm_argv(_config(request_rate=10), output_path="/tmp/r.json")
        assert "--rate-type=constant" in argv
        assert "--rate=10" in argv

    def test_target_and_model_present(self) -> None:
        argv = build_guidellm_argv(
            _config(target_url="http://t/v1", model="m"),
            output_path="/tmp/r.json",
        )
        assert "--target=http://t/v1" in argv
        assert "--model=m" in argv

    def test_max_requests_and_duration_present(self) -> None:
        argv = build_guidellm_argv(
            _config(total_requests=500, max_duration_seconds=600),
            output_path="/tmp/r.json",
        )
        assert "--max-requests=500" in argv
        assert "--max-seconds=600" in argv

    def test_random_dataset_uses_prompt_and_output_tokens(self) -> None:
        argv = build_guidellm_argv(
            _config(dataset_name="random", prompt_tokens=2048, output_tokens=256),
            output_path="/tmp/r.json",
        )
        # guidellm accepts --data prompt_tokens=N,output_tokens=M
        data_args = [a for a in argv if a.startswith("--data=")]
        assert len(data_args) == 1
        assert "prompt_tokens=2048" in data_args[0]
        assert "output_tokens=256" in data_args[0]

    def test_random_dataset_includes_seed_when_set(self) -> None:
        argv = build_guidellm_argv(
            _config(dataset_seed=42),
            output_path="/tmp/r.json",
        )
        assert "--random-seed=42" in argv

    def test_random_dataset_omits_seed_when_unset(self) -> None:
        argv = build_guidellm_argv(_config(dataset_seed=None), output_path="/tmp/r.json")
        assert not any(a.startswith("--random-seed=") for a in argv)

    def test_output_path_is_passed(self) -> None:
        argv = build_guidellm_argv(_config(), output_path="/tmp/specific-report.json")
        assert "--output-path=/tmp/specific-report.json" in argv

    def test_command_is_benchmark_runner(self) -> None:
        argv = build_guidellm_argv(_config(), output_path="/tmp/r.json")
        # gpustack/benchmark-runner CLI: `benchmark-runner benchmark run`.
        assert argv[0:3] == ["benchmark-runner", "benchmark", "run"]

    def test_backend_is_openai_http(self) -> None:
        argv = build_guidellm_argv(_config(), output_path="/tmp/r.json")
        assert "--backend=openai_http" in argv

    def test_console_is_disabled(self) -> None:
        # Headless container — the interactive progress bar would just spam
        # captured stdout. State callbacks carry the lifecycle instead.
        argv = build_guidellm_argv(_config(), output_path="/tmp/r.json")
        assert "--disable-console" in argv

    def test_api_key_is_passed_via_backend_kwargs(self) -> None:
        # OpenAIHTTPBackend reads `api_key` from --backend-kwargs JSON and
        # turns it into the Authorization header. Without this, every real
        # vLLM/OpenAI target 401s.
        import json as _json

        argv = build_guidellm_argv(_config(api_key="sk-secret-123"), output_path="/tmp/r.json")
        bk = next((a for a in argv if a.startswith("--backend-kwargs=")), None)
        assert bk is not None, "argv must include --backend-kwargs"
        payload = _json.loads(bk.split("=", 1)[1])
        assert payload == {"api_key": "sk-secret-123"}

    def test_sharegpt_not_yet_supported(self) -> None:
        # ShareGPT is deferred to Phase 6 — the runner refuses now so a
        # mis-routed Phase-1 controller request fails loud.
        with pytest.raises(NotImplementedError, match="sharegpt"):
            build_guidellm_argv(_config(dataset_name="sharegpt"), output_path="/tmp/r.json")
