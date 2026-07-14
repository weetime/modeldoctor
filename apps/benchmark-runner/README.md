# modeldoctor-benchmark-runner

Thin Python wrapper around benchmark tools
([guidellm](https://github.com/neuralmagic/guidellm) via
[gpustack/benchmark-runner](https://hub.docker.com/r/gpustack/benchmark-runner),
and [vegeta](https://github.com/tsenart/vegeta))
that runs a single benchmark against an OpenAI-compatible target and writes
lifecycle + output to the shared report-storage bucket; the ModelDoctor API
picks them up via a K8s pod watcher (state) and a pod-log stream (live logs).

This image is launched by the `K8sJobDriver` and `SubprocessDriver`.
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

## Quick build + import

The standard workflow is the helper script at the repo root:

```bash
./tools/build-runner-images.sh
```

This computes a content-addressed tag from the runner source's git SHA, builds all three images, and imports them into the local k3d cluster. The script prints the tag and the matching `RUNNER_IMAGE_*` lines for `.env`.

Manual build commands (below) are kept for reference but the script is preferred.

## Building the images (manual, advanced)

Prerequisite: Docker (or Podman with `alias docker=podman`) must be installed and running.

```bash
# guidellm (gpustack/benchmark-runner base, ~2.5 GB CPU-only torch)
docker build -f apps/benchmark-runner/images/guidellm.Dockerfile \
             -t md-runner-guidellm:dev3 \
             apps/benchmark-runner/

# vegeta (python:3.11-slim + static vegeta binary, ~135 MB)
docker build -f apps/benchmark-runner/images/vegeta.Dockerfile \
             -t md-runner-vegeta:dev3 \
             apps/benchmark-runner/
```

The guidellm base is pinned to `gpustack/benchmark-runner:v0.0.3` — bumping
is a deliberate PR with new fixture-based metrics-mapper tests, since
guidellm's report schema occasionally renames fields between versions.

## Environment-variable contract

The wrapper reads these env vars at startup — set by both `K8sJobDriver` (Pod
env + per-run Secret + shared storage Secret) and `SubprocessDriver` (process
env) before launching the container.

**Wrapper inputs (per run):**

| Variable | Required | Description |
|---|---|---|
| `MD_BENCHMARK_ID` | yes | Opaque benchmark identifier (UUID). Used as the object-store key prefix (e.g. `<id>/result.json`). |
| `MD_ARGV` | yes | JSON array — the full argv to exec (e.g. `["vegeta","attack",...]`). The wrapper execs this verbatim. |
| `MD_OUTPUT_FILES` | yes | JSON object mapping alias → relative file path (e.g. `{"result":"result.json"}`). After the tool exits the wrapper uploads each existing file to `<id>/files/<alias>` in the shared report-storage bucket. |
| `MD_INPUT_FILE_PATHS` | no | JSON object mapping alias → absolute mount path. K8s mode only — the wrapper symlinks each source path into cwd so the tool's relative argv paths resolve correctly. Subprocess driver writes files directly to cwd and omits this var. |

**Output sink (pick one; injected via the `md-benchmark-storage` Secret in K8s mode).** The wrapper writes the same `<id>/...` layout either way. Selection: `S3_ENDPOINT` set → S3 (online / k8s); else `MD_OUTPUT_DIR` set → local mount (offline / air-gapped); else fail-fast.

| Variable | Required | Description |
|---|---|---|
| `S3_ENDPOINT` | when online | Endpoint URL of the shared object store (e.g. `http://minio:9000`). Its presence selects the S3 sink. |
| `S3_ACCESS_KEY` | with S3 | Access key id for the object store. |
| `S3_SECRET_KEY` | with S3 | Secret access key for the object store. |
| `S3_BUCKET` | with S3 | Bucket the wrapper writes into. Same bucket the API reads from. |
| `S3_REGION` | no | Defaults to `us-east-1` — harmless against MinIO, but required by the boto3 client. |
| `MD_OUTPUT_DIR` | when offline | Local output root (a mounted path). Used **when `S3_ENDPOINT` is unset** — the wrapper writes here instead of S3, same `<id>/...` layout, no S3 client or MinIO needed. `S3_ENDPOINT` wins if both are set. Offline usage: `-v "$PWD/out:/out" -e MD_OUTPUT_DIR=/out`. |

**Tool API keys (forwarded into argv at exec time):**

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | no | Merged into any `--backend-kwargs={...}` JSON in `MD_ARGV` (for guidellm). Set via the per-run Secret in K8s mode. |

### Report storage layout

The wrapper writes a fixed set of objects to `S3_BUCKET` keyed by `MD_BENCHMARK_ID`. The shape matches `reportStorageKeys` in `packages/contracts/src/benchmark.ts` — runner writes, API reads, both must agree.

| Step | Object key | When written |
|---|---|---|
| 1. Start metadata | `<id>/meta.json` — `{toolVersion, startTimeIso}` | Before exec, after `<tool> --version` capture |
| 2. Output files | `<id>/files/<alias>` (multipart upload for >5 MB) | After tool exits, only for files that exist |
| 3. Captured stdout/stderr | `<id>/stdout.log` and `<id>/stderr.log` | After tool exits, full buffered tail from `StreamPump` |
| 4. Terminal sentinel | `<id>/result.json` — `{exitCode, finishTimeIso, files}` | LAST. API treats its presence as "storage complete". |

The wrapper propagates the tool's exit code (`pod.phase == Succeeded` ↔ exit 0; non-zero ↔ `pod.phase == Failed`). The K8s job-watcher in the API reconciles pod state against the `result.json` sentinel and updates the benchmark row in Postgres; live stdout/stderr is tailed via the K8s pod-log API rather than pushed from the runner.

## Running the image (manual smoke test)

The smoke tests below require an S3-compatible object store reachable from
the container — a local MinIO works fine. The examples assume MinIO at
`http://host.docker.internal:9000` with the default `minioadmin` credentials
and a pre-created bucket named `modeldoctor-dev`.

### Sanity check — simplest possible test

```bash
docker run --rm \
  -e MD_BENCHMARK_ID=smoke-01 \
  -e MD_ARGV='["echo","hello from runner"]' \
  -e MD_OUTPUT_FILES='{}' \
  -e S3_ENDPOINT=http://host.docker.internal:9000 \
  -e S3_ACCESS_KEY=minioadmin \
  -e S3_SECRET_KEY=minioadmin \
  -e S3_BUCKET=modeldoctor-dev \
  md-runner-vegeta:dev3
```

Expected: the wrapper writes `smoke-01/meta.json`, execs `echo hello from runner`,
then writes `smoke-01/stdout.log`, `smoke-01/stderr.log`, and finally
`smoke-01/result.json`. Exit code 0.

To verify, point any S3 client at the same endpoint:

```bash
# Using the AWS CLI against MinIO
aws --endpoint-url http://localhost:9000 s3 ls s3://modeldoctor-dev/smoke-01/
# expect: meta.json, stdout.log, stderr.log, result.json

aws --endpoint-url http://localhost:9000 s3 cp s3://modeldoctor-dev/smoke-01/result.json -
# expect: {"exitCode": 0, "finishTimeIso": "...", "files": {}}
```

(Linux Docker without Desktop: replace `host.docker.internal` with
`172.17.0.1`, or pass `--add-host=host.docker.internal:host-gateway`.)

### Offline / air-gapped — no object store

Drop the `S3_*` vars and mount a local output dir instead. Same image, same
entrypoint, same `<id>/...` layout — results land on the host directly.

```bash
docker run --rm \
  -e MD_BENCHMARK_ID=smoke-offline \
  -e MD_ARGV='["echo","hello from runner"]' \
  -e MD_OUTPUT_FILES='{}' \
  -e MD_OUTPUT_DIR=/out -v "$PWD/out:/out" \
  md-runner-vegeta:dev3

# results are on the host, no S3 client needed:
cat out/smoke-offline/result.json   # {"exitCode": 0, "finishTimeIso": "...", "files": {}}
ls  out/smoke-offline/              # meta.json  stdout.log  stderr.log  result.json
```

### Real vegeta run

```bash
docker run --rm \
  -e MD_BENCHMARK_ID=dev-$(date +%s) \
  -e MD_ARGV='["sh","-c","echo GET https://httpbin.org/get | vegeta attack -rate=1 -duration=3s | vegeta report -type=json -output=result.json"]' \
  -e MD_OUTPUT_FILES='{"result":"result.json"}' \
  -e S3_ENDPOINT=http://host.docker.internal:9000 \
  -e S3_ACCESS_KEY=minioadmin \
  -e S3_SECRET_KEY=minioadmin \
  -e S3_BUCKET=modeldoctor-dev \
  md-runner-vegeta:dev3
```

### Real guidellm run

```bash
docker run --rm \
  -e MD_BENCHMARK_ID=dev-$(date +%s) \
  -e MD_ARGV='["benchmark-runner","benchmark","run","--target","https://your-vllm-host/v1","--model","facebook/opt-125m","--max-requests","10","--output-path","report.json"]' \
  -e MD_OUTPUT_FILES='{"report":"report.json"}' \
  -e S3_ENDPOINT=http://host.docker.internal:9000 \
  -e S3_ACCESS_KEY=minioadmin \
  -e S3_SECRET_KEY=minioadmin \
  -e S3_BUCKET=modeldoctor-dev \
  md-runner-guidellm:dev3
```

## Air-gapped clusters

The evalscope + aiperf images bake their datasets at build time so runs work without internet egress from the cluster:

| Image | Dataset enum value | Baked path | Source |
|---|---|---|---|
| evalscope | `longalpaca` | `/opt/evalscope-datasets/longalpaca/` | `AI-ModelScope/LongAlpaca-12k` (modelscope) |
| evalscope | `openqa` | `/opt/evalscope-datasets/openqa/open_qa.jsonl` | `AI-ModelScope/HC3-Chinese:open_qa.jsonl` |
| evalscope | `random` | n/a (synthetic) | — |
| aiperf | `sharegpt` | `/app/.cache/aiperf/datasets/ShareGPT_V3_unfiltered_cleaned_split.json` | `anon8231489123/ShareGPT_Vicuna_unfiltered` (HuggingFace) |
| aiperf | `synthetic` | n/a (built-in generator) | — |

After build + before deploy, run `apps/benchmark-runner/scripts/verify-airgap.sh` to confirm every baked path is reachable with `--network none`.

Image-size impact (rough):

- `md-runner-evalscope`: ~1.75 GB (`python:3.11-slim` base + evalscope ~1.4 GB + LongAlpaca ~200 MB + open_qa ~50 MB)
- `md-runner-aiperf`: ~1.7 GB (base + aiperf deps ~300 MB + ShareGPT ~672 MB)

If a future dataset needs to be added:
1. Add the bake step in the relevant Dockerfile.
2. Add the path to `packages/tool-adapters/src/<tool>/runtime.ts` `BAKED_DATASET_PATHS` (evalscope) or document where the loader picks it up (aiperf).
3. Add a check to `verify-airgap.sh`.
4. Update this table.
