# modeldoctor-benchmark-runner

Thin Python wrapper around benchmark tools
([guidellm](https://github.com/neuralmagic/guidellm) via
[gpustack/benchmark-runner](https://hub.docker.com/r/gpustack/benchmark-runner),
and [vegeta](https://github.com/tsenart/vegeta))
that runs a single benchmark against an OpenAI-compatible target and POSTs
lifecycle + output back to ModelDoctor's API.

This image is launched by Phase 3's `K8sJobDriver` and `SubprocessDriver`.
You should rarely run it directly except for image-level smoke testing.

As of Phase 3 (#53) there is **one image per tool** — `images/guidellm.Dockerfile`
and `images/vegeta.Dockerfile` — so a vegeta-only image carries no ML dependencies.

## Local development

```bash
cd apps/benchmark-runner
conda create -n modeldoctor-benchmark-runner python=3.11 -y
conda activate modeldoctor-benchmark-runner
pip install -e ".[dev]"
pytest
ruff check .
ruff format --check .   # CI runs this too — `ruff format .` to auto-apply
```

(Non-conda contributors can substitute `python3.11 -m venv .venv && source .venv/bin/activate` —
the project itself is environment-manager-agnostic; only the dev workflow above prefers conda.)

## Building the images

Prerequisite: Docker (or Podman with `alias docker=podman`) must be installed and running.

```bash
# guidellm (gpustack/benchmark-runner base, ~2.5 GB CPU-only torch)
docker build -f apps/benchmark-runner/images/guidellm.Dockerfile \
             -t md-runner-guidellm:dev2 \
             apps/benchmark-runner/

# vegeta (python:3.11-slim + static vegeta binary, ~135 MB)
docker build -f apps/benchmark-runner/images/vegeta.Dockerfile \
             -t md-runner-vegeta:dev2 \
             apps/benchmark-runner/
```

The guidellm base is pinned to `gpustack/benchmark-runner:v0.0.3` — bumping
is a deliberate PR with new fixture-based metrics-mapper tests, since
guidellm's report schema occasionally renames fields between versions.

## Environment-variable contract (MD_* vars)

The wrapper reads these env vars at startup — set by both `K8sJobDriver` (as
Pod env) and `SubprocessDriver` (as process env) before launching the container:

| Variable | Required | Description |
|---|---|---|
| `MD_RUN_ID` | yes | Opaque run identifier (UUID). Used as the path segment in callback URLs. |
| `MD_CALLBACK_URL` | yes | Base URL of the ModelDoctor API (e.g. `http://api:3000`). Trailing slash is tolerated. |
| `MD_CALLBACK_TOKEN` | yes | Bearer token included in every callback POST (`Authorization: Bearer <token>`). |
| `MD_ARGV` | yes | JSON array — the full argv to exec (e.g. `["vegeta","attack",...]`). The wrapper execs this verbatim. |
| `MD_OUTPUT_FILES` | yes | JSON object mapping alias → relative file path (e.g. `{"result":"result.json"}`). After the tool exits the wrapper base64-encodes each existing file and includes it in `/finish`. |
| `MD_INPUT_FILE_PATHS` | no | JSON object mapping alias → absolute mount path. K8s mode only — the wrapper symlinks each source path into cwd so the tool's relative argv paths resolve correctly. Subprocess driver writes files directly to cwd and omits this var. |

### Callback URLs (API v2, introduced in #53)

All callbacks are relative to `MD_CALLBACK_URL`:

| Event | Method + path |
|---|---|
| Tool started | `POST api/internal/runs/<run_id>/state` — `{"state":"running"}` |
| Log lines (streaming, every 250 ms) | `POST api/internal/runs/<run_id>/log` — `{"stream":"stdout"\|"stderr","lines":[...]}` |
| Tool finished (terminal) | `POST api/internal/runs/<run_id>/finish` — `{"state":"completed"\|"failed","exitCode":N,"stdout":"...","stderr":"...","files":{...},"message":"..."}` |

The wrapper always exits 0 itself; tool failure is conveyed via `state: "failed"` in `/finish`.

## Running the image (manual smoke test)

### Sanity check — simplest possible test

```bash
docker run --rm \
  -e MD_RUN_ID=smoke-01 \
  -e MD_CALLBACK_URL=http://host.docker.internal:3001 \
  -e MD_CALLBACK_TOKEN=dev-token \
  -e MD_ARGV='["echo","hello from runner"]' \
  -e MD_OUTPUT_FILES='{}' \
  md-runner-vegeta:dev2
```

Expected: the wrapper POSTs `state=running`, execs `echo hello from runner`,
streams the line to `/log`, then POSTs `/finish` with `state=completed` and exits 0.

To observe the callbacks, run this stub server in a second terminal:

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
python stub_callback.py   # terminal 2 — listens on :3001
```

Expected output in stub terminal:
1. `POST /api/internal/runs/smoke-01/state <- {'state': 'running'}`
2. `POST /api/internal/runs/smoke-01/log <- {'stream': 'stdout', 'lines': ['hello from runner']}`
3. `POST /api/internal/runs/smoke-01/finish <- {'state': 'completed', 'exitCode': 0, ...}`

(Linux Docker without Desktop: replace `host.docker.internal` with
`172.17.0.1`, or pass `--add-host=host.docker.internal:host-gateway`.)

### Real vegeta run

```bash
docker run --rm \
  -e MD_RUN_ID=dev-$(date +%s) \
  -e MD_CALLBACK_URL=http://host.docker.internal:3001 \
  -e MD_CALLBACK_TOKEN=dev-token \
  -e MD_ARGV='["sh","-c","echo GET https://httpbin.org/get | vegeta attack -rate=1 -duration=3s | vegeta report -type=json -output=result.json"]' \
  -e MD_OUTPUT_FILES='{"result":"result.json"}' \
  md-runner-vegeta:dev2
```

### Real guidellm run

```bash
docker run --rm \
  -e MD_RUN_ID=dev-$(date +%s) \
  -e MD_CALLBACK_URL=http://host.docker.internal:3001 \
  -e MD_CALLBACK_TOKEN=dev-token \
  -e MD_ARGV='["benchmark-runner","benchmark","run","--target","https://your-vllm-host/v1","--model","facebook/opt-125m","--max-requests","10","--output-path","report.json"]' \
  -e MD_OUTPUT_FILES='{"report":"report.json"}' \
  md-runner-guidellm:dev2
```
