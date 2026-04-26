# modeldoctor-benchmark-runner

Thin Python wrapper around [gpustack/benchmark-runner](https://hub.docker.com/r/gpustack/benchmark-runner)
(GPUStack's extension of [guidellm](https://github.com/neuralmagic/guidellm))
that runs a single benchmark against an OpenAI-compatible target and POSTs
lifecycle + metrics back to ModelDoctor's API.

This image is launched by Phase 3's `K8sJobDriver` and `SubprocessDriver`.
You should rarely run it directly except for image-level smoke testing.

The Docker base ships guidellm with CPU-only torch (~2.5 GB) — bumping the
`gpustack/benchmark-runner:vX.Y.Z` pin in the Dockerfile is a deliberate
PR with new fixture-based metrics-mapper tests, since guidellm's report
schema occasionally renames fields between versions.

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

Assumes you have a vLLM (or any OpenAI-compatible) server reachable. To
observe the runner's callbacks, drop this stub server into a scratch file
and run it in a second terminal — it logs every incoming POST and 200s:

```python
# stub_callback.py
from aiohttp import web

async def echo(request: web.Request) -> web.Response:
    body = await request.json()
    print(f"{request.method} {request.path} <- {body}")
    return web.Response(status=200)

app = web.Application()
app.router.add_route("*", "/{tail:.*}", echo)
web.run_app(app, port=3001)
```

```bash
python stub_callback.py        # terminal 2 — listens on :3001

docker run --rm \              # terminal 1
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

(Linux Docker without Desktop: replace `host.docker.internal` with
`172.17.0.1`, or pass `--add-host=host.docker.internal:host-gateway`.)

Expected behavior:
1. Stub prints `POST /api/internal/benchmarks/<id>/state <- {'state': 'running'}`.
2. Stub prints `POST /api/internal/benchmarks/<id>/metrics <- {...}` (full summary + raw).
3. Stub prints `POST /api/internal/benchmarks/<id>/state <- {'state': 'completed', 'progress': 1.0}`.
4. Container exits 0.
