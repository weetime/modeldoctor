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
