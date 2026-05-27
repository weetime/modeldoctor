# syntax=docker/dockerfile:1.6
# Base image for the evalscope runner.
# Contains evalscope + modelscope + baked datasets — NO ModelDoctor runner scripts.
# Rebuild and push only when bumping tool versions; tag matches EVALSCOPE_VERSION.
#
#   ./tools/build-base-images.sh evalscope
#
# Then update evalscope.Dockerfile's FROM line to the new tag.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MODELSCOPE_CACHE=/opt/evalscope-datasets

ARG EVALSCOPE_VERSION=1.7.0

# Install modelscope first (stable, rarely bumped) so the baked-dataset layers
# below stay in the build cache across evalscope version/extra changes — only
# the much smaller evalscope layer at the end re-runs on a bump.
RUN pip install --no-cache-dir --disable-pip-version-check "modelscope==1.36.3"

# Bake LongAlpaca-12k. modelscope download's positional `repo_id` defaults
# to model lookup; LongAlpaca-12k is a dataset, so `--dataset` is required.
RUN modelscope download \
        --dataset AI-ModelScope/LongAlpaca-12k \
        --local_dir /opt/evalscope-datasets/longalpaca

# Bake openqa (HC3-Chinese) for the inf-evalscope-short template + any
# openqa-driven manual runs. Only open_qa.jsonl is needed.
RUN python -c "from modelscope import dataset_snapshot_download; \
    import shutil, os; \
    p = dataset_snapshot_download('AI-ModelScope/HC3-Chinese', allow_patterns=['open_qa.jsonl']); \
    os.makedirs('/opt/evalscope-datasets/openqa', exist_ok=True); \
    shutil.copy(os.path.join(p, 'open_qa.jsonl'), '/opt/evalscope-datasets/openqa/open_qa.jsonl')"

# evalscope LAST, with the [perf] extra — `evalscope perf` imports uvicorn via
# evalscope.perf.utils.local_server; without [perf] the runner dies with
# `ModuleNotFoundError: No module named 'uvicorn'`. Re-pin modelscope so the
# extra's dependency resolution can't drift it off the dataset-baking version.
RUN pip install --no-cache-dir --disable-pip-version-check \
        "evalscope[perf]==${EVALSCOPE_VERSION}" \
        "modelscope==1.36.3"
