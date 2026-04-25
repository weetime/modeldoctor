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
