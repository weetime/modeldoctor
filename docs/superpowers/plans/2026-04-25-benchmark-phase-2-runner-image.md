# Benchmark Feature — Phase 2 Implementation Plan (Runner Image)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the standalone Python container `modeldoctor/benchmark-runner` that Phase 3's drivers (K8sJobDriver and SubprocessDriver) will launch. The image is a thin wrapper around `guidellm` that reads its configuration from env vars, drives `guidellm benchmark` against an OpenAI-compatible target endpoint, and POSTs lifecycle + metrics back to the API via the contracts agreed in Phase 1. Independent of Phase 1's NestJS code — coupled only by the wire format on the callback path.

**Architecture:** A single Python project at `apps/benchmark-runner/` with one runtime module (`runner/main.py`, ~150 LoC), pure-function helpers for arg-building / metrics-mapping / callback HTTP, and a pytest suite that mocks the `guidellm` subprocess and the `requests.post` call. The Dockerfile produces a `python:3.11-slim`-based image that pre-installs `guidellm` and runs `python -m runner` as the entrypoint. CI builds the image on every PR; pushes happen later (Phase 3 wires this into `BENCHMARK_RUNNER_IMAGE`).

**Tech Stack:** Python 3.11, `guidellm` (pinned), `requests` (HTTP client — same one used by guidellm so no extra dep), `pytest` + `pytest-mock` (dev), `ruff` (lint+format, dev). **Local dev uses conda** for env management (per user preference); `pip install -e ".[dev]"` runs inside the conda env. Docker uses `python:3.11-slim` directly (no conda in the image — keeps it slim). CI uses `actions/setup-python` (no conda either). The `pyproject.toml` is conda-agnostic; conda is only the local-dev shell.

**Source spec:** `docs/superpowers/specs/2026-04-25-benchmark-design.md` — §5 (Runner Image), §2.1 (where the image fits in the architecture), §2.2 trust boundaries (HMAC token + apiKey via env without leaking to logs/argv), §9 (testing strategy for the runner).

**Source contracts:** `packages/contracts/src/benchmark.ts` (Phase 1) — `BenchmarkStateCallbackSchema`, `BenchmarkMetricsCallbackSchema`, `BenchmarkMetricsSummarySchema`, `BenchmarkProfile`, `BenchmarkApiType`, `BenchmarkDataset`, `BenchmarkState`. Python has no auto-import from Zod, so we re-encode the wire shape in Python (with a single round-trip test that asserts the runner's outgoing payloads pass the corresponding Zod parser; see Task 5).

**Testing discipline:**
- **TDD for code modules.** `runner/argv.py`, `runner/callback.py`, `runner/metrics.py` are pure-ish — write the failing test, then the minimal impl, then commit.
- **`runner/main.py` is integration-tested with everything mocked.** `subprocess.run` is patched to a fake that produces a canned guidellm JSON; `requests.post` is patched to a recorder. The single `test_main_happy_path` walks the full pipeline.
- **No live `guidellm` invocation in unit tests.** That happens in the Docker smoke test (a manual command in the README; Phase 6 will add a CI integration test against a stub OpenAI server).
- **Wire-format round-trip test.** `tests/test_wire_format.py` shells out to a small Node script that imports the Phase-1 Zod schemas and validates a sample payload the Python builder emits. This catches contract drift between TS and Python *at PR time*, not at Phase-3 wiring time. (If shelling to Node from pytest is awkward in CI, we fall back to maintaining a JSON Schema export and validating against that — see Task 5 for the decision tree.)

**Commit cadence:** One commit per task. Conventional-commit prefixes per `CLAUDE.md`:
- `feat:` runtime code (new modules)
- `test:` test-only changes (rare; tests usually land *with* their impl)
- `chore:` Docker / CI / project scaffolding
- `build:` package / pyproject / dependency changes
- `docs:` README

Every commit body ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

**Environment assumptions:**
- Working directory: the current ModelDoctor repo root.
- **conda available locally**: `conda --version` works. The user manages all Python environments via conda; the plan does not assume a system `python3.11` binary on PATH.
- Docker daemon running: `docker info` succeeds.
- `pip` works inside the conda env (the plan does `pip install -e ".[dev]"` after `conda activate`).
- Phase 1 has merged into `feat/restructure` (PR #11). Phase 2 branches from there.

---

## Pre-flight

- [ ] **Step 0.1: Confirm clean working tree**

```bash
git status
```
Expected: `nothing to commit, working tree clean`. Stash or commit before proceeding.

- [ ] **Step 0.2: Sync the integration branch**

```bash
git checkout feat/restructure
git pull --ff-only
```
Expected: fast-forwarded to the merge commit of Phase 1 PR #11 (`b17d569` or later). If `pull --ff-only` refuses, your local has diverged — investigate before proceeding.

- [ ] **Step 0.3: Create the Phase 2 branch**

```bash
git checkout -b feat/benchmark-phase-2
```
Expected: `Switched to a new branch 'feat/benchmark-phase-2'`. PR target: `feat/restructure`.

- [ ] **Step 0.4: Confirm conda is available**

```bash
conda --version
```
Expected: `conda x.y.z` printed (any 23.x or 24.x). If missing, install Miniconda or Anaconda first. The plan uses conda to materialize a Python 3.11 environment in Step 1.5; do not pre-create the env yet.

- [ ] **Step 0.5: Confirm Docker is running**

```bash
docker info | head -5
```
Expected: server info prints (not a "Cannot connect" error).

- [ ] **Step 0.6: Confirm baseline tests pass**

```bash
pnpm -r type-check
pnpm -r test
pnpm -r lint
```
Expected: all green. Phase 1's contributions (159 tests, lint-clean) must still pass on the integration branch.

---

## Phase 2 Tasks

Phase goal (restated): the directory `apps/benchmark-runner/` exists with a Python project that builds into a Docker image. The image, when run with the right env vars, executes `guidellm benchmark` against an OpenAI-compatible target and POSTs lifecycle + metrics back to a callback URL using the wire format defined in `packages/contracts/src/benchmark.ts`. CI builds the image on every PR. Manual smoke test instructions in the README walk a developer through `docker build` → `docker run` against a local stub.

---

### Task 1: Python project skeleton

**Files:**
- Create: `apps/benchmark-runner/pyproject.toml`
- Create: `apps/benchmark-runner/.python-version`
- Create: `apps/benchmark-runner/.gitignore`
- Create: `apps/benchmark-runner/.dockerignore`
- Create: `apps/benchmark-runner/README.md`
- Create: `apps/benchmark-runner/runner/__init__.py`
- Create: `apps/benchmark-runner/tests/__init__.py`
- Create: `apps/benchmark-runner/tests/conftest.py`

This task is verified by `pip install -e ".[dev]"` succeeding and `pytest --collect-only` returning 0 tests cleanly.

- [ ] **Step 1.1: Create `pyproject.toml`**

```toml
[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "modeldoctor-benchmark-runner"
version = "0.1.0"
description = "Thin wrapper around guidellm for ModelDoctor's benchmark feature"
requires-python = ">=3.11"
dependencies = [
  # Pin guidellm to a specific minor — bumping is a deliberate PR with new
  # fixture-based metrics-mapper tests. Update with care.
  "guidellm==0.4.0",
  # `requests` is already a transitive dep of guidellm, but we depend on it
  # explicitly for the callback HTTP client so a future guidellm bump that
  # drops it doesn't break us.
  "requests>=2.31,<3",
]

[project.optional-dependencies]
dev = [
  "pytest>=8,<9",
  "pytest-mock>=3.12,<4",
  "ruff>=0.5,<1",
]

[project.scripts]
# `python -m runner` is the canonical entrypoint; this script is a convenience
# for ad-hoc use during development.
modeldoctor-benchmark-runner = "runner.main:main"

[tool.setuptools.packages.find]
include = ["runner*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-q"

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "SIM", "C4"]
```

- [ ] **Step 1.2: Create supporting dotfiles**

`apps/benchmark-runner/.python-version`:
```
3.11
```

`apps/benchmark-runner/.gitignore`:
```
.venv/
__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/
*.egg-info/
build/
dist/
```

`apps/benchmark-runner/.dockerignore`:
```
.venv/
__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/
*.egg-info/
build/
dist/
tests/
```

(Note: `tests/` is excluded from the Docker image — the runtime container does not need them.)

- [ ] **Step 1.3: Create the package skeleton**

`apps/benchmark-runner/runner/__init__.py`:
```python
"""ModelDoctor benchmark runner — thin guidellm wrapper, called once per BenchmarkRun."""
```

`apps/benchmark-runner/tests/__init__.py`: (empty file — makes pytest treat the directory as a package)

`apps/benchmark-runner/tests/conftest.py`:
```python
"""Shared pytest fixtures for the benchmark runner test suite."""
from __future__ import annotations

from collections.abc import Iterator

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
```

- [ ] **Step 1.4: Stub the README**

`apps/benchmark-runner/README.md`:
```markdown
# modeldoctor-benchmark-runner

Thin Python wrapper around [guidellm](https://github.com/neuralmagic/guidellm)
that runs a single benchmark against an OpenAI-compatible target and POSTs
lifecycle + metrics back to ModelDoctor's API.

This image is launched by Phase 3's `K8sJobDriver` and `SubprocessDriver`.
You should rarely run it directly except for image-level smoke testing.

## Local development

```bash
cd apps/benchmark-runner
conda create -n modeldoctor-benchmark-runner python=3.11 -y
conda activate modeldoctor-benchmark-runner
pip install -e ".[dev]"
pytest
ruff check .
```

(Non-conda contributors can substitute `python3.11 -m venv .venv && source .venv/bin/activate` —
the project itself is environment-manager-agnostic; only the dev workflow above prefers conda.)

## Building the image

```bash
docker build -t modeldoctor/benchmark-runner:dev apps/benchmark-runner/
```

## Running the image (manual smoke test)

See `docs/superpowers/specs/2026-04-25-benchmark-design.md` §5.2 for the env-var contract.
A minimal invocation:

```bash
docker run --rm \
  -e BENCHMARK_ID=ck-test \
  -e CALLBACK_URL=http://host.docker.internal:3001 \
  -e CALLBACK_TOKEN=dev-token \
  -e TARGET_URL=http://host.docker.internal:8000/v1 \
  -e API_KEY=sk-test \
  -e MODEL=facebook/opt-125m \
  -e API_TYPE=chat \
  -e DATASET_NAME=random \
  -e PROMPT_TOKENS=1024 \
  -e OUTPUT_TOKENS=128 \
  -e REQUEST_RATE=0 \
  -e TOTAL_REQUESTS=10 \
  -e MAX_DURATION_SECONDS=600 \
  modeldoctor/benchmark-runner:dev
```
```

- [ ] **Step 1.5: Create the conda env and install**

```bash
cd apps/benchmark-runner
conda create -n modeldoctor-benchmark-runner python=3.11 -y
conda activate modeldoctor-benchmark-runner
pip install --upgrade pip
pip install -e ".[dev]"
```
Expected: `Successfully installed ... guidellm-0.4.0 ... pytest ... ruff ...`. Record what you actually got — if guidellm 0.4.0 has been yanked, drop to 0.4.1 etc. and update the pyproject pin.

(All subsequent task steps that say "activate" mean `conda activate modeldoctor-benchmark-runner`; "deactivate" means `conda deactivate`. The conda env lives outside the repo — nothing to commit, nothing to .gitignore beyond what's already there.)

- [ ] **Step 1.6: Verify the project layout works**

```bash
pytest --collect-only
ruff check .
```
Expected: `pytest` reports `0 tests collected` (it's looking, found nothing — fine for now); `ruff check .` exits 0.

- [ ] **Step 1.7: Deactivate the env and return to repo root**

```bash
conda conda deactivate
cd ../..
```

- [ ] **Step 1.8: Commit**

```bash
git add apps/benchmark-runner/
git commit -m "$(cat <<'EOF'
chore(benchmark-runner): scaffold Python project

Conda env + pip install workflow (per user preference; non-conda
contributors can substitute venv). pyproject pins guidellm==0.4.0;
bumping is a deliberate PR with new fixture-based mapper tests.
Includes README with the env-var contract for manual docker-run
smoke testing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: argv builder (TDD)

**Files:**
- Create: `apps/benchmark-runner/runner/argv.py`
- Create: `apps/benchmark-runner/tests/test_argv.py`

The argv builder takes the parsed env config and emits the `guidellm benchmark` argv list. Pure function — easy to test in isolation. Two key branches:
- `REQUEST_RATE > 0` → `--rate-type=constant --rate=<N>`
- `REQUEST_RATE == 0` → `--rate-type=throughput` (no `--rate`)

- [ ] **Step 2.1: Write the failing test file**

`apps/benchmark-runner/tests/test_argv.py`:
```python
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

    def test_command_is_benchmark(self) -> None:
        argv = build_guidellm_argv(_config(), output_path="/tmp/r.json")
        # First two tokens are the program and subcommand.
        assert argv[0] == "guidellm"
        assert argv[1] == "benchmark"

    def test_sharegpt_not_yet_supported(self) -> None:
        # ShareGPT is deferred to Phase 6 — the runner refuses now so a
        # mis-routed Phase-1 controller request fails loud.
        with pytest.raises(NotImplementedError, match="sharegpt"):
            build_guidellm_argv(_config(dataset_name="sharegpt"), output_path="/tmp/r.json")
```

- [ ] **Step 2.2: Run tests and verify they fail**

```bash
cd apps/benchmark-runner
conda activate modeldoctor-benchmark-runner
pytest tests/test_argv.py
```
Expected: every test fails with `ImportError` / `ModuleNotFoundError` for `runner.argv`.

- [ ] **Step 2.3: Implement `runner/argv.py`**

`apps/benchmark-runner/runner/argv.py`:
```python
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
```

- [ ] **Step 2.4: Run tests and verify they pass**

```bash
pytest tests/test_argv.py
```
Expected: all 10 tests pass.

- [ ] **Step 2.5: Lint**

```bash
ruff check .
ruff format --check .
```
Expected: both exit 0. If `ruff format --check` fails, run `ruff format .` to auto-fix.

- [ ] **Step 2.6: Commit**

```bash
conda deactivate
cd ../..
git add apps/benchmark-runner/runner/argv.py apps/benchmark-runner/tests/test_argv.py
git commit -m "$(cat <<'EOF'
feat(benchmark-runner): argv builder for guidellm benchmark

Pure function translating a parsed EnvConfig into the guidellm CLI
argv. Two rate-mode branches (constant when rate>0, throughput when
rate=0=unlimited) and an explicit NotImplementedError for sharegpt
so a mis-routed request fails loud rather than silently emitting an
invalid CLI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: env parser (TDD)

**Files:**
- Create: `apps/benchmark-runner/runner/env.py`
- Create: `apps/benchmark-runner/tests/test_env.py`

Reads `os.environ`, returns a typed `EnvConfig`. Required fields raise `MissingEnvError` with the variable name. Type coercion via `int()` for numeric fields, `Literal` validation for enum-like fields (`API_TYPE`, `DATASET_NAME`).

- [ ] **Step 3.1: Write the failing test file**

`apps/benchmark-runner/tests/test_env.py`:
```python
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
    def test_missing_required_var_raises(self, env_minimal: dict[str, str], missing_key: str) -> None:
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
```

- [ ] **Step 3.2: Run tests and verify they fail**

```bash
cd apps/benchmark-runner
conda activate modeldoctor-benchmark-runner
pytest tests/test_env.py
```
Expected: every test fails with import error.

- [ ] **Step 3.3: Implement `runner/env.py`**

`apps/benchmark-runner/runner/env.py`:
```python
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
```

- [ ] **Step 3.4: Run tests and verify they pass**

```bash
pytest tests/test_env.py
```
Expected: all ~20 tests pass (the parametrize generates 13 missing-var tests).

- [ ] **Step 3.5: Lint and commit**

```bash
ruff check .
ruff format --check .
conda deactivate
cd ../..
git add apps/benchmark-runner/runner/env.py apps/benchmark-runner/tests/test_env.py
git commit -m "$(cat <<'EOF'
feat(benchmark-runner): env-var parser with type coercion

Parses os.environ into a typed EnvConfig. Required fields raise
MissingEnvError naming the missing variable; type errors (non-int,
unknown literal) raise ValueError. DATASET_SEED is the only optional
field. The Literal validation for API_TYPE and DATASET_NAME mirrors
the Zod enums in @modeldoctor/contracts so a controller-bypassing
launch fails loud.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: callback HTTP client (TDD)

**Files:**
- Create: `apps/benchmark-runner/runner/callback.py`
- Create: `apps/benchmark-runner/tests/test_callback.py`

Two functions: `post_state(callback_url, token, *, state, message=None, progress=None)` and `post_metrics(callback_url, token, *, summary, raw, logs)`. Both POST JSON to `{callback_url}/api/internal/benchmarks/{id}/{state|metrics}` with `Authorization: Bearer {token}`. Phase 1 added these endpoints in spec but didn't implement them yet — Phase 3 implements them. The wire format **must** match `BenchmarkStateCallbackSchema` and `BenchmarkMetricsCallbackSchema`.

Important: the `BENCHMARK_ID` is part of the URL path, so the callback functions take it as a parameter. The runner reads it from env once.

- [ ] **Step 4.1: Write the failing test file**

`apps/benchmark-runner/tests/test_callback.py`:
```python
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
```

- [ ] **Step 4.2: Run, fail, implement**

```bash
cd apps/benchmark-runner
conda activate modeldoctor-benchmark-runner
pytest tests/test_callback.py
```
Expected: failures from missing module.

`apps/benchmark-runner/runner/callback.py`:
```python
"""Callback HTTP client — runner pod → API."""

from __future__ import annotations

from typing import Any

import requests

# Keep timeouts short — the API service is in-cluster and we don't want to
# block the runner forever if the network glitches. The reconciler will
# eventually mark a stuck run as failed.
_TIMEOUT_SECONDS = 10


def _post(url: str, token: str, body: dict[str, Any]) -> None:
    resp = requests.post(
        url,
        json=body,
        headers={"Authorization": f"Bearer {token}"},
        timeout=_TIMEOUT_SECONDS,
    )
    if not resp.ok:
        raise RuntimeError(
            f"Callback POST {url} returned {resp.status_code}: {resp.text[:200]}"
        )


def post_state(
    *,
    callback_url: str,
    token: str,
    benchmark_id: str,
    state: str,
    message: str | None = None,
    progress: float | None = None,
) -> None:
    """POST a lifecycle update to the API."""
    body: dict[str, Any] = {"state": state}
    if message is not None:
        body["stateMessage"] = message
    if progress is not None:
        body["progress"] = progress
    _post(f"{callback_url}/api/internal/benchmarks/{benchmark_id}/state", token, body)


def post_metrics(
    *,
    callback_url: str,
    token: str,
    benchmark_id: str,
    summary: dict[str, Any],
    raw: dict[str, Any],
    logs: str | None,
) -> None:
    """POST the final metrics payload to the API."""
    body: dict[str, Any] = {"metricsSummary": summary, "rawMetrics": raw}
    if logs is not None:
        body["logs"] = logs
    _post(f"{callback_url}/api/internal/benchmarks/{benchmark_id}/metrics", token, body)
```

- [ ] **Step 4.3: Re-run, expect green; lint; commit**

```bash
pytest tests/test_callback.py
ruff check .
conda deactivate
cd ../..
git add apps/benchmark-runner/runner/callback.py apps/benchmark-runner/tests/test_callback.py
git commit -m "$(cat <<'EOF'
feat(benchmark-runner): HMAC-authenticated callback HTTP client

Two functions for the runner→API control plane: post_state for
lifecycle transitions, post_metrics for the final metrics+logs
delivery. Both POST JSON to /api/internal/benchmarks/<id>/{state,
metrics} with Authorization: Bearer <token>. Wire format mirrors
BenchmarkStateCallbackSchema and BenchmarkMetricsCallbackSchema
in @modeldoctor/contracts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: metrics mapper (TDD)

**Files:**
- Create: `apps/benchmark-runner/runner/metrics.py`
- Create: `apps/benchmark-runner/tests/test_metrics.py`
- Create: `apps/benchmark-runner/tests/fixtures/guidellm_report.json`

Translates guidellm's JSON report into the `BenchmarkMetricsSummary` shape Phase 1 defined. The guidellm 0.4.x report is well-documented but we don't trust it 1:1 — the mapper is defensive (missing field → 0 or null with logging) and the *test* uses a fixture matching the documented shape.

The fixture is deliberately small (one benchmark group, ~30 lines of JSON).

- [ ] **Step 5.1: Write the fixture**

`apps/benchmark-runner/tests/fixtures/guidellm_report.json`:
```json
{
  "benchmarks": [
    {
      "args": { "rate_type": "throughput" },
      "metrics": {
        "time_to_first_token_ms": { "mean": 120, "median": 110, "p95": 200, "p99": 320 },
        "inter_token_latency_ms": { "mean": 25, "median": 22, "p95": 50, "p99": 80 },
        "request_latency_ms": { "mean": 1800, "median": 1700, "p95": 2500, "p99": 3200 },
        "requests_per_second": { "mean": 12.4 },
        "output_tokens_per_second": { "mean": 1580 },
        "prompt_tokens_per_second": { "mean": 12700 },
        "tokens_per_second": { "mean": 14280 },
        "request_concurrency": { "mean": 8.2, "max": 12 }
      },
      "summary": {
        "requests": 1000,
        "errors": 1,
        "incomplete": 1
      }
    }
  ]
}
```

- [ ] **Step 5.2: Write the failing test file**

`apps/benchmark-runner/tests/test_metrics.py`:
```python
from __future__ import annotations

import json
from pathlib import Path

from runner.metrics import map_guidellm_report_to_summary

FIXTURE = Path(__file__).parent / "fixtures" / "guidellm_report.json"


class TestMapGuidellmReport:
    def test_maps_full_fixture(self) -> None:
        raw = json.loads(FIXTURE.read_text())
        summary = map_guidellm_report_to_summary(raw)
        assert summary == {
            "ttft": {"mean": 120, "p50": 110, "p95": 200, "p99": 320},
            "itl": {"mean": 25, "p50": 22, "p95": 50, "p99": 80},
            "e2eLatency": {"mean": 1800, "p50": 1700, "p95": 2500, "p99": 3200},
            "requestsPerSecond": {"mean": 12.4},
            "outputTokensPerSecond": {"mean": 1580},
            "inputTokensPerSecond": {"mean": 12700},
            "totalTokensPerSecond": {"mean": 14280},
            "concurrency": {"mean": 8.2, "max": 12},
            "requests": {"total": 1000, "success": 998, "error": 1, "incomplete": 1},
        }

    def test_empty_benchmarks_yields_zero_summary(self) -> None:
        summary = map_guidellm_report_to_summary({"benchmarks": []})
        # All numeric fields default to 0; no schema violation.
        assert summary["ttft"] == {"mean": 0, "p50": 0, "p95": 0, "p99": 0}
        assert summary["requests"] == {"total": 0, "success": 0, "error": 0, "incomplete": 0}

    def test_missing_metrics_section_defaults_to_zero(self) -> None:
        broken = {"benchmarks": [{"args": {}, "summary": {"requests": 0}}]}
        summary = map_guidellm_report_to_summary(broken)
        assert summary["ttft"]["mean"] == 0
        assert summary["concurrency"]["max"] == 0
```

- [ ] **Step 5.3: Run, fail, implement**

```bash
cd apps/benchmark-runner
conda activate modeldoctor-benchmark-runner
pytest tests/test_metrics.py
```
Expected: failures.

`apps/benchmark-runner/runner/metrics.py`:
```python
"""Map a guidellm JSON report to the BenchmarkMetricsSummary wire shape.

Defensive: any missing field defaults to 0/null. We choose not to crash on
malformed reports because (a) guidellm versions occasionally rename fields
and we'd rather ship slightly stale numbers than fail-the-run, (b) the
controller already has the rawMetrics blob for forensic reconstruction.
"""

from __future__ import annotations

from typing import Any


def _latency(metrics: dict[str, Any], key: str) -> dict[str, float]:
    src = metrics.get(key, {})
    # guidellm uses "median" for p50.
    return {
        "mean": float(src.get("mean", 0)),
        "p50": float(src.get("median", 0)),
        "p95": float(src.get("p95", 0)),
        "p99": float(src.get("p99", 0)),
    }


def _rate(metrics: dict[str, Any], key: str) -> dict[str, float]:
    src = metrics.get(key, {})
    return {"mean": float(src.get("mean", 0))}


def map_guidellm_report_to_summary(raw: dict[str, Any]) -> dict[str, Any]:
    """Translate guidellm's report JSON to the BenchmarkMetricsSummary shape.

    Missing fields default to 0 — see module docstring for rationale. The
    raw report is preserved unchanged on the BenchmarkRun row so anything
    the mapper drops can be reconstructed offline.
    """
    benches = raw.get("benchmarks", [])
    # We only emit one benchmark group per run, so take the first if any.
    first = benches[0] if benches else {}
    metrics = first.get("metrics", {})
    summary_section = first.get("summary", {})

    concurrency = metrics.get("request_concurrency", {})
    requests_total = int(summary_section.get("requests", 0))
    errors = int(summary_section.get("errors", 0))
    incomplete = int(summary_section.get("incomplete", 0))
    success = max(0, requests_total - errors - incomplete)

    return {
        "ttft": _latency(metrics, "time_to_first_token_ms"),
        "itl": _latency(metrics, "inter_token_latency_ms"),
        "e2eLatency": _latency(metrics, "request_latency_ms"),
        "requestsPerSecond": _rate(metrics, "requests_per_second"),
        "outputTokensPerSecond": _rate(metrics, "output_tokens_per_second"),
        "inputTokensPerSecond": _rate(metrics, "prompt_tokens_per_second"),
        "totalTokensPerSecond": _rate(metrics, "tokens_per_second"),
        "concurrency": {
            "mean": float(concurrency.get("mean", 0)),
            "max": float(concurrency.get("max", 0)),
        },
        "requests": {
            "total": requests_total,
            "success": success,
            "error": errors,
            "incomplete": incomplete,
        },
    }
```

- [ ] **Step 5.4: Re-run, expect green; lint; commit**

```bash
pytest tests/test_metrics.py
ruff check .
conda deactivate
cd ../..
git add apps/benchmark-runner/runner/metrics.py apps/benchmark-runner/tests/test_metrics.py apps/benchmark-runner/tests/fixtures/
git commit -m "$(cat <<'EOF'
feat(benchmark-runner): map guidellm report to wire metrics summary

Defensive translation of guidellm's report.json into the
BenchmarkMetricsSummary shape from @modeldoctor/contracts. Missing
fields default to 0 — guidellm versions occasionally rename keys
and the controller stores the rawMetrics blob anyway, so a mapper
gap is recoverable offline rather than a failed run.

Includes a fixture file documenting the guidellm 0.4.x report shape
the mapper expects.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: main orchestrator (TDD)

**Files:**
- Create: `apps/benchmark-runner/runner/__main__.py`
- Create: `apps/benchmark-runner/runner/main.py`
- Create: `apps/benchmark-runner/tests/test_main.py`

Glues the four prior pieces together. Reads env, posts state=running, spawns guidellm, parses the report, posts metrics, posts state=completed. On failure: posts state=failed with stderr tail and exits 1.

The orchestrator's tests mock `subprocess.run` and the callback module entirely. There's *no live guidellm* in this test — that's the Docker smoke test (Task 7).

- [ ] **Step 6.1: Write the failing test**

`apps/benchmark-runner/tests/test_main.py`:
```python
from __future__ import annotations

import json
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import MagicMock, call

import pytest
from pytest_mock import MockerFixture

from runner import main as main_mod

FIXTURE = Path(__file__).parent / "fixtures" / "guidellm_report.json"


@pytest.fixture
def patched(mocker: MockerFixture, tmp_path: Path) -> dict[str, MagicMock]:
    """Patch every external surface (subprocess, callback HTTP, output file)."""
    # subprocess.run returns success and writes the fixture into the output path.
    def fake_run(argv: list[str], **_kwargs: object) -> CompletedProcess[bytes]:
        # Find the --output-path=X arg and copy the fixture there.
        for a in argv:
            if a.startswith("--output-path="):
                out = a.split("=", 1)[1]
                Path(out).write_text(FIXTURE.read_text())
        return CompletedProcess(argv, 0, stdout=b"guidellm log\n", stderr=b"")

    return {
        "run": mocker.patch("runner.main.subprocess.run", side_effect=fake_run),
        "post_state": mocker.patch("runner.main.post_state"),
        "post_metrics": mocker.patch("runner.main.post_metrics"),
        "tmp_dir": tmp_path,
    }


def test_main_happy_path_posts_running_completed_and_metrics(
    patched: dict[str, MagicMock], env_minimal: dict[str, str], mocker: MockerFixture
) -> None:
    mocker.patch.dict("os.environ", env_minimal, clear=True)
    # Redirect /tmp/report.json to a tmp_path so tests are isolated.
    mocker.patch("runner.main._OUTPUT_PATH", str(patched["tmp_dir"] / "report.json"))

    rc = main_mod.main()
    assert rc == 0

    # state callbacks: running first, then completed
    state_calls = patched["post_state"].call_args_list
    assert state_calls[0].kwargs["state"] == "running"
    assert state_calls[-1].kwargs["state"] == "completed"

    # metrics call: exactly one
    assert patched["post_metrics"].call_count == 1
    metrics_kwargs = patched["post_metrics"].call_args.kwargs
    assert "metricsSummary" not in metrics_kwargs  # passed as 'summary' kwarg
    assert metrics_kwargs["summary"]["ttft"]["mean"] == 120
    assert metrics_kwargs["raw"]["benchmarks"][0]["summary"]["requests"] == 1000


def test_main_failure_posts_failed_with_stderr_tail(
    mocker: MockerFixture, env_minimal: dict[str, str]
) -> None:
    mocker.patch.dict("os.environ", env_minimal, clear=True)
    mocker.patch(
        "runner.main.subprocess.run",
        return_value=CompletedProcess([], 1, stdout=b"x" * 200, stderr=b"BOOM" * 50),
    )
    post_state = mocker.patch("runner.main.post_state")
    post_metrics = mocker.patch("runner.main.post_metrics")

    rc = main_mod.main()
    assert rc == 1

    # First state call: running. Final state call: failed with stderr tail.
    assert post_state.call_args_list[0].kwargs["state"] == "running"
    final = post_state.call_args_list[-1]
    assert final.kwargs["state"] == "failed"
    assert "BOOM" in final.kwargs["message"]

    # No metrics callback when guidellm exits non-zero.
    assert post_metrics.call_count == 0


def test_main_missing_env_exits_with_error(
    mocker: MockerFixture, env_minimal: dict[str, str]
) -> None:
    del env_minimal["TARGET_URL"]
    mocker.patch.dict("os.environ", env_minimal, clear=True)
    post_state = mocker.patch("runner.main.post_state")
    mocker.patch("runner.main.subprocess.run")  # should never be called

    rc = main_mod.main()
    assert rc == 1
    # Cannot post state without callback URL, but env_minimal still has it.
    # The runner should have posted state=failed with a useful message.
    failed = post_state.call_args_list
    assert any(c.kwargs.get("state") == "failed" for c in failed)
```

- [ ] **Step 6.2: Run, fail, implement**

```bash
cd apps/benchmark-runner
conda activate modeldoctor-benchmark-runner
pytest tests/test_main.py
```
Expected: failures.

`apps/benchmark-runner/runner/main.py`:
```python
"""Runner entrypoint — reads env, runs guidellm, posts callbacks, exits 0/1."""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys

from runner.argv import build_guidellm_argv
from runner.callback import post_metrics, post_state
from runner.env import MissingEnvError, parse_env
from runner.metrics import map_guidellm_report_to_summary

# Default location for guidellm's --output-path. Tests patch this.
_OUTPUT_PATH = "/tmp/report.json"

# Tail size for stderr included in the state=failed callback.
_STDERR_TAIL_BYTES = 1024

logging.basicConfig(level=logging.INFO, format="[runner] %(message)s")
log = logging.getLogger("runner")


def _stderr_tail(stderr: bytes) -> str:
    if not stderr:
        return ""
    tail = stderr[-_STDERR_TAIL_BYTES:]
    try:
        return tail.decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001 — defensive
        return repr(tail)


def main() -> int:
    """Run a single benchmark; return process exit code."""
    raw_env = dict(os.environ)
    callback_url = raw_env.get("CALLBACK_URL")
    callback_token = raw_env.get("CALLBACK_TOKEN")
    benchmark_id = raw_env.get("BENCHMARK_ID")

    try:
        cfg = parse_env(raw_env)
    except (MissingEnvError, ValueError) as e:
        log.error("env parse failed: %s", e)
        # Best-effort failure callback if we know enough URL/token/id.
        if callback_url and callback_token and benchmark_id:
            try:
                post_state(
                    callback_url=callback_url,
                    token=callback_token,
                    benchmark_id=benchmark_id,
                    state="failed",
                    message=f"env parse: {e}",
                )
            except Exception as cb_e:  # noqa: BLE001
                log.error("failed to post failure callback: %s", cb_e)
        return 1

    # state=running before doing anything heavy.
    try:
        post_state(
            callback_url=cfg.callback_url,
            token=cfg.callback_token,
            benchmark_id=cfg.benchmark_id,
            state="running",
        )
    except Exception as e:  # noqa: BLE001
        log.error("running callback failed: %s — continuing anyway", e)

    argv = build_guidellm_argv(cfg, output_path=_OUTPUT_PATH)
    log.info("running: %s", " ".join(argv))
    proc = subprocess.run(argv, capture_output=True, check=False)  # noqa: S603

    if proc.returncode != 0:
        msg = f"guidellm exited {proc.returncode}: {_stderr_tail(proc.stderr)}"
        log.error(msg)
        try:
            post_state(
                callback_url=cfg.callback_url,
                token=cfg.callback_token,
                benchmark_id=cfg.benchmark_id,
                state="failed",
                message=msg[:2048],
            )
        except Exception as e:  # noqa: BLE001
            log.error("failed callback also failed: %s", e)
        return 1

    # Parse the report file produced by guidellm.
    try:
        report = json.loads(open(_OUTPUT_PATH).read())  # noqa: SIM115
    except Exception as e:  # noqa: BLE001
        log.error("failed to read report at %s: %s", _OUTPUT_PATH, e)
        try:
            post_state(
                callback_url=cfg.callback_url,
                token=cfg.callback_token,
                benchmark_id=cfg.benchmark_id,
                state="failed",
                message=f"report parse: {e}",
            )
        except Exception as cb_e:  # noqa: BLE001
            log.error("failed to post failure callback: %s", cb_e)
        return 1

    summary = map_guidellm_report_to_summary(report)

    # Final metrics + completed.
    try:
        post_metrics(
            callback_url=cfg.callback_url,
            token=cfg.callback_token,
            benchmark_id=cfg.benchmark_id,
            summary=summary,
            raw=report,
            logs=proc.stdout.decode("utf-8", errors="replace") if proc.stdout else None,
        )
        post_state(
            callback_url=cfg.callback_url,
            token=cfg.callback_token,
            benchmark_id=cfg.benchmark_id,
            state="completed",
            progress=1.0,
        )
    except Exception as e:  # noqa: BLE001
        log.error("final callback failed: %s", e)
        # Don't return 1 — guidellm succeeded, we just couldn't tell anyone.
        # The reconciler will pick this up.
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
```

`apps/benchmark-runner/runner/__main__.py`:
```python
"""Allow ``python -m runner`` to invoke the runner entrypoint."""
import sys

from runner.main import main

sys.exit(main())
```

- [ ] **Step 6.3: Re-run, expect green; lint; commit**

```bash
pytest
ruff check .
conda deactivate
cd ../..
git add apps/benchmark-runner/runner/main.py apps/benchmark-runner/runner/__main__.py apps/benchmark-runner/tests/test_main.py
git commit -m "$(cat <<'EOF'
feat(benchmark-runner): main orchestrator wiring env+argv+subprocess+callbacks

Reads env → posts state=running → runs guidellm subprocess → parses
report → posts metrics + state=completed. On guidellm non-zero exit,
posts state=failed with the stderr tail (capped at 2 KB on the wire,
1 KB tail captured) and returns 1. On callback-only failures (post-
guidellm), returns 0 and lets the API reconciler clean up — running
out of "tell the API" doesn't mean the run was bad.

`python -m runner` is the canonical entrypoint via __main__.py; the
console_script in pyproject is a convenience for ad-hoc dev use.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Dockerfile + manual smoke instructions

**Files:**
- Create: `apps/benchmark-runner/Dockerfile`
- Modify: `apps/benchmark-runner/README.md` (expand the smoke-test section)

Multi-stage build: deps stage installs guidellm + project into the slim image's system site-packages; runtime stage copies that site-packages plus the project source and runs `python -m runner`. (No venv and no conda inside the image — `python:3.11-slim` already gives us a clean isolated Python.) Image is small enough — `python:3.11-slim` is ~50 MB, guidellm pulls ~400 MB of transformers/tokenizers. Final image ~500 MB.

Verification: `docker build` succeeds; `docker run --rm IMAGE python -m runner` errors fast with `MissingEnvError` (proving the entrypoint is wired).

- [ ] **Step 7.1: Create the Dockerfile**

`apps/benchmark-runner/Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1.6

FROM python:3.11-slim AS deps

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Copy only what's needed for dependency resolution first; this layer
# is cached as long as pyproject.toml doesn't change.
COPY pyproject.toml ./
COPY runner/__init__.py runner/__init__.py

RUN pip install --upgrade pip && pip install .

# ---- runtime stage ----

FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Copy the entire site-packages from the deps stage. python:3.11-slim's
# stdlib is enough; we don't need build toolchain at runtime.
COPY --from=deps /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin

# Copy the project source. Tests are excluded by .dockerignore.
COPY runner runner

# Run as a non-root user. The home dir doesn't have to exist for python -m.
RUN useradd --create-home --shell /sbin/nologin runner
USER runner

ENTRYPOINT ["python", "-m", "runner"]
```

- [ ] **Step 7.2: Build the image**

```bash
cd apps/benchmark-runner
docker build -t modeldoctor/benchmark-runner:dev .
cd ../..
```
Expected: `Successfully tagged modeldoctor/benchmark-runner:dev`. Build takes ~2-4 minutes the first time (transformers download), ~10-20 seconds incrementally.

- [ ] **Step 7.3: Smoke test the image**

```bash
docker run --rm modeldoctor/benchmark-runner:dev 2>&1 | head -5
```
Expected: a `MissingEnvError: Missing required env var: BENCHMARK_ID` line and the container exits 1. This proves the entrypoint is wired and parse_env is invoked. (We're not actually running guidellm against anything yet — Phase 6 hardens that with a stub OpenAI server.)

- [ ] **Step 7.4: Expand README with the manual smoke flow**

Replace the existing "Running the image (manual smoke test)" section in `apps/benchmark-runner/README.md` with:

```markdown
## Running the image (manual smoke test)

The image is meant to be launched by Phase 3's drivers, not by hand. For
image-level smoke testing:

### Sanity check (just verify the entrypoint)

```bash
docker run --rm modeldoctor/benchmark-runner:dev
```
Expected: exits 1 with `MissingEnvError: Missing required env var: BENCHMARK_ID`.
Confirms `python -m runner` is wired correctly.

### Real run against a vLLM target

Assumes you have a vLLM (or any OpenAI-compatible) server reachable, and a
local stub server listening on port 3001 that prints incoming POSTs (a 30-line
Python `aiohttp` script — see Phase 6's planned integration test).

```bash
docker run --rm \
  -e BENCHMARK_ID=dev-$(date +%s) \
  -e CALLBACK_URL=http://host.docker.internal:3001 \
  -e CALLBACK_TOKEN=dev-token \
  -e TARGET_URL=https://your-vllm-host/v1 \
  -e API_KEY="$VLLM_API_KEY" \
  -e MODEL=facebook/opt-125m \
  -e API_TYPE=chat \
  -e DATASET_NAME=random \
  -e PROMPT_TOKENS=128 \
  -e OUTPUT_TOKENS=64 \
  -e REQUEST_RATE=0 \
  -e TOTAL_REQUESTS=10 \
  -e MAX_DURATION_SECONDS=120 \
  modeldoctor/benchmark-runner:dev
```

Expected behavior:
1. Stub server receives `POST /api/internal/benchmarks/<id>/state` with `{"state":"running"}`.
2. Stub server receives `POST /api/internal/benchmarks/<id>/metrics` with the full summary.
3. Stub server receives `POST /api/internal/benchmarks/<id>/state` with `{"state":"completed","progress":1.0}`.
4. Container exits 0.
```

- [ ] **Step 7.5: Commit**

```bash
git add apps/benchmark-runner/Dockerfile apps/benchmark-runner/README.md
git commit -m "$(cat <<'EOF'
chore(benchmark-runner): multi-stage Dockerfile + manual smoke flow

Two-stage build (deps → runtime) on python:3.11-slim. ENTRYPOINT is
"python -m runner". Runs as non-root user. Image is ~500 MB (most
of which is transformers/tokenizers pulled by guidellm).

README's smoke-test section now documents both the trivial sanity
check (no env → MissingEnvError) and the full vLLM-target run.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: CI workflow + final verification

**Files:**
- Create: `.github/workflows/benchmark-runner.yml`

A separate workflow for the runner — only fires on pushes that touch `apps/benchmark-runner/**`. Two jobs: `python` (lint + test under `actions/setup-python` — no conda in CI; conda is a local-dev convenience only) and `docker-build` (build only, no push — Phase 3's deploy plan handles registry push). Independent of the existing `ci.yml` because the Python toolchain is orthogonal to pnpm.

- [ ] **Step 8.1: Create the workflow**

`.github/workflows/benchmark-runner.yml`:
```yaml
name: benchmark-runner

on:
  pull_request:
    paths:
      - 'apps/benchmark-runner/**'
      - '.github/workflows/benchmark-runner.yml'
  push:
    branches: [main]
    paths:
      - 'apps/benchmark-runner/**'
      - '.github/workflows/benchmark-runner.yml'

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  python:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: apps/benchmark-runner
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'
          cache-dependency-path: apps/benchmark-runner/pyproject.toml
      - run: pip install --upgrade pip
      - run: pip install -e ".[dev]"
      - run: ruff check .
      - run: ruff format --check .
      - run: pytest

  docker-build:
    runs-on: ubuntu-latest
    needs: python
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build (no push)
        uses: docker/build-push-action@v5
        with:
          context: apps/benchmark-runner
          push: false
          tags: modeldoctor/benchmark-runner:ci
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 8.2: Verify locally one more time**

```bash
cd apps/benchmark-runner
conda activate modeldoctor-benchmark-runner
pytest
ruff check .
ruff format --check .
conda deactivate
cd ../..
docker build -t modeldoctor/benchmark-runner:dev apps/benchmark-runner/
```
Expected: pytest green (all tests across the four test files), ruff clean, docker build success.

- [ ] **Step 8.3: Commit the workflow**

```bash
git add .github/workflows/benchmark-runner.yml
git commit -m "$(cat <<'EOF'
chore(ci): add benchmark-runner workflow (python + docker build)

Path-filtered workflow that fires only when apps/benchmark-runner/**
changes. Two jobs: pytest+ruff under Python 3.11, then a docker
buildx build of the image (no push — Phase 3's deploy plan handles
registry push). Orthogonal to the existing pnpm CI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8.4: Inspect the commit graph**

```bash
git log --oneline -8
```
Expected: 8 commits in this order, all on `feat/benchmark-phase-2`:
1. `chore(benchmark-runner): scaffold Python project`
2. `feat(benchmark-runner): argv builder for guidellm benchmark`
3. `feat(benchmark-runner): env-var parser with type coercion`
4. `feat(benchmark-runner): HMAC-authenticated callback HTTP client`
5. `feat(benchmark-runner): map guidellm report to wire metrics summary`
6. `feat(benchmark-runner): main orchestrator wiring env+argv+subprocess+callbacks`
7. `chore(benchmark-runner): multi-stage Dockerfile + manual smoke flow`
8. `chore(ci): add benchmark-runner workflow (python + docker build)`

- [ ] **Step 8.5: Push and open the PR**

```bash
git push -u origin feat/benchmark-phase-2
```

```bash
gh pr create --base feat/restructure --title "feat(benchmark): phase 2 — runner image" --body "$(cat <<'EOF'
## Summary
- New Python project at `apps/benchmark-runner/`: env parser, argv builder, callback HTTP client, guidellm-report→summary mapper, main orchestrator. ~50 unit tests.
- Multi-stage Dockerfile producing `modeldoctor/benchmark-runner:dev` (~500 MB; transformers/tokenizers dominate).
- New CI workflow `.github/workflows/benchmark-runner.yml` — path-filtered, runs Python lint+tests then a docker buildx build.

Independent of Phase 1's NestJS code. Coupled only by the wire format on the callback path: `BenchmarkStateCallbackSchema` and `BenchmarkMetricsCallbackSchema` from `@modeldoctor/contracts`.

Spec: `docs/superpowers/specs/2026-04-25-benchmark-design.md` §5.
Plan: `docs/superpowers/plans/2026-04-25-benchmark-phase-2-runner-image.md`.

## Test plan
- [ ] Python: `pytest` green across 4 test files (~50 tests)
- [ ] Lint: `ruff check .` and `ruff format --check .` green
- [ ] Image: `docker build -t modeldoctor/benchmark-runner:dev apps/benchmark-runner/` succeeds
- [ ] Smoke: `docker run --rm modeldoctor/benchmark-runner:dev` exits 1 with `MissingEnvError`
- [ ] CI: the new workflow runs and is green on this PR

## Watch out for in Phase 3
- guidellm version pin (`==0.4.0`) is the contract for the metrics mapper. Bumping is a deliberate PR with a new fixture.
- The image does NOT request a GPU. Phase 3's K8sJobDriver Job spec must NOT add `nvidia.com/gpu` resources.
- Image is large (~500 MB). First-pull on a fresh node ≈ 30-60s. Phase 3 should set `imagePullPolicy: IfNotPresent`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL returned. Wait for CI to finish before merging.

---

## Phase 2 Done When

- Branch `feat/benchmark-phase-2` exists with the 8 commits above.
- `pytest` green; `ruff check .` and `ruff format --check .` green.
- `docker build` succeeds; `docker run --rm modeldoctor/benchmark-runner:dev` exits 1 with `MissingEnvError`.
- The new `.github/workflows/benchmark-runner.yml` is green on the PR.
- A PR is open targeting `feat/restructure`.

Phase 3 (`feat/benchmark-phase-3-drivers-callback`) implements the API-side drivers + callback endpoints + reconciler, which together make this image actually do something. Phase 3 can be developed in parallel — the wire-format contract is already locked in by Phase 1.
