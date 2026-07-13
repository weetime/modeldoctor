# syntax=docker/dockerfile:1.6
# Base image for the evalscope runner.
# Contains evalscope + modelscope + baked datasets — NO ModelDoctor runner scripts.
# Rebuild and push only when the tool version or the baked datasets change.
#
#   ./tools/build-base-images.sh evalscope
#
# The image TAG (EVALSCOPE_IMAGE_TAG in build-base-images.sh) tracks the base
# *content* version and is decoupled from the evalscope pip version below: bump
# the tag whenever a baked dataset is added/changed even if evalscope itself is
# unchanged. Then update evalscope.Dockerfile's FROM line to the new tag.
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
# openqa-driven manual runs. Only open_qa.jsonl is needed. evalscope's openqa
# plugin reads this jsonl directly via --dataset-path (line-by-line + json),
# so it's served as-is.
RUN python -c "from modelscope import dataset_snapshot_download; \
    import shutil, os; \
    p = dataset_snapshot_download('AI-ModelScope/HC3-Chinese', allow_patterns=['open_qa.jsonl']); \
    os.makedirs('/opt/evalscope-datasets/openqa', exist_ok=True); \
    shutil.copy(os.path.join(p, 'open_qa.jsonl'), '/opt/evalscope-datasets/openqa/open_qa.jsonl')"

# Flatten LongAlpaca to one prompt per line for evalscope's `line_by_line` reader.
# Why not serve it natively: the longalpaca plugin's --dataset-path code path does
# json.loads() of a single JSON-array file, but ModelScope ships LongAlpaca-12k as
# a CSV (+ metadata stub), and the cluster can't auto-download (pod TLS to
# modelscope.cn fails). line_by_line streams the file, so the full corpus costs no
# runtime RAM; each instruction is collapsed to a single line (newlines stripped).
# Drop the raw CSV download afterwards — the .txt replaces it.
RUN python3 <<'PY'
import csv, sys, shutil
csv.field_size_limit(sys.maxsize)
src = '/opt/evalscope-datasets/longalpaca/LongAlpaca-12k_.csv'
dst = '/opt/evalscope-datasets/longalpaca.txt'
n = 0
with open(src, encoding='utf-8') as f, open(dst, 'w', encoding='utf-8') as out:
    for row in csv.DictReader(f):
        line = ' '.join((row.get('instruction') or '').split())
        if line:
            out.write(line + '\n')
            n += 1
shutil.rmtree('/opt/evalscope-datasets/longalpaca')
print('longalpaca.txt lines:', n)
PY

# Bake swift/sharegpt multi-turn conversations (~406 MB EN + ~460 MB ZH) for the
# share_gpt_en / share_gpt_zh datasets. evalscope's share_gpt plugin reads the
# jsonl directly via --dataset-path (see packages/tool-adapters/src/evalscope/
# runtime.ts), skipping the modelscope auto-download the cluster can't reach.
# Only these two files are needed; the repo also ships computer_*/unknow_* which
# allow_patterns filters out. Downloaded straight into local_dir (no cache copy)
# and asserted non-empty — the modelscope CLI silently exits 0 with 0 files on a
# name typo, so we guard against baking an empty dataset.
RUN python3 <<'PY'
from modelscope import dataset_snapshot_download
import os, shutil
d = '/opt/evalscope-datasets/sharegpt'
keep = ('common_en_70k.jsonl', 'common_zh_70k.jsonl')
dataset_snapshot_download('swift/sharegpt', local_dir=d, allow_patterns=list(keep))
for f in keep:
    sz = os.path.getsize(os.path.join(d, f))
    if sz == 0:
        raise SystemExit(f'sharegpt bake failed: {f} is empty')
    print(f'{f}: {sz} bytes')
# Drop modelscope's download metadata (.msc/.mv/._____temp) — evalscope reads the
# jsonl by explicit --dataset-path, so only the two corpora need to persist.
for name in os.listdir(d):
    if name not in keep:
        p = os.path.join(d, name)
        shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
PY

# evalscope LAST, with the [perf] extra — `evalscope perf` imports uvicorn via
# evalscope.perf.utils.local_server; without [perf] the runner dies with
# `ModuleNotFoundError: No module named 'uvicorn'`. Re-pin modelscope so the
# extra's dependency resolution can't drift it off the dataset-baking version.
RUN pip install --no-cache-dir --disable-pip-version-check \
        "evalscope[perf]==${EVALSCOPE_VERSION}" \
        "modelscope==1.36.3"
